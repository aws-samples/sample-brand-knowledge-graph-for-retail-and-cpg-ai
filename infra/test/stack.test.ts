// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AGENT_DEADLINE_S, AGENT_V2_REGIONS } from '../lib/agents';
import { contentHash, LAMBDA_REQUIREMENTS, LAMBDA_RUNTIME } from '../lib/bundling';
import { configureApp } from '../lib/nag';
import {
  API_FUNCTION_TIMEOUT_S,
  checkFrameAncestors,
  DEFAULT_DOMAIN,
  DEFAULT_VISION_MODEL_IDS,
  MultimodalAiKnowledgeGraphStack,
  MultimodalAiKnowledgeGraphStackProps,
  PIPELINE_FUNCTION_TIMEOUT_S,
} from '../lib/multimodal-ai-knowledge-graph-stack';

/** No asset bundling (the Lambda and agent zips are built at deploy time; seconds to minutes). */
const NO_BUNDLING = { 'aws:cdk:bundling-stacks': [] };

/** The stack as bin/app.ts builds it: the project tag and the cdk-nag checks included (nag.test.ts covers the findings). */
function synth(extra: Partial<MultimodalAiKnowledgeGraphStackProps> = {}) {
  const app = new cdk.App({ context: { '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false, ...NO_BUNDLING } });
  configureApp(app);
  const stack = new MultimodalAiKnowledgeGraphStack(app, 'Test', {
    env: { account: '111111111111', region: 'us-east-1' },
    ...extra,
  });
  return Template.fromStack(stack);
}

const API = 'ontology_rag.lambda_handler.api_handler';
const PIPELINE = 'ontology_rag.lambda_handler.pipeline_handler';
const LOADER = 'ontology_rag.lambda_handler.loader_handler';
const AUTH_SETUP = 'ontology_rag.lambda_handler.auth_setup_handler';

/** The function with this handler (exactly one). */
function fnByHandler(t: Template, handler: string): any {
  const fns = Object.values(t.findResources('AWS::Lambda::Function', { Properties: { Handler: handler } }));
  expect(fns).toHaveLength(1);
  return fns[0];
}

/** The logical id of the function with this handler (exactly one). */
function logicalIdOfFn(t: Template, handler: string): string {
  const ids = Object.keys(t.findResources('AWS::Lambda::Function', { Properties: { Handler: handler } }));
  expect(ids).toHaveLength(1);
  return ids[0];
}

/** Every IAM statement attached to the execution role of the function with this handler. */
function roleStatements(t: Template, handler: string): any[] {
  const roleId = fnByHandler(t, handler).Properties.Role['Fn::GetAtt'][0];
  return Object.values(t.findResources('AWS::IAM::Policy'))
    .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
    .flatMap((p: any) => p.Properties.PolicyDocument.Statement);
}

const actionsOf = (s: any): string[] => ([] as string[]).concat(s.Action);
/** The logical id of the bucket whose construct id starts with `prefix` (SiteBucket, OntologiesBucket, LogsBucket). */
const bucketId = (t: Template, prefix: string): string => {
  const ids = Object.keys(t.findResources('AWS::S3::Bucket')).filter((id) => id.startsWith(prefix));
  expect(ids).toHaveLength(1);
  return ids[0];
};
const dataBucketId = (t: Template) => bucketId(t, 'OntologiesBucket');
const logicalId = (t: Template, type: string): string => {
  const ids = Object.keys(t.findResources(type));
  expect(ids).toHaveLength(1);
  return ids[0];
};
/** The one resource of this type. */
const oneOf = (t: Template, type: string): any => t.findResources(type)[logicalId(t, type)];
/** The logical ids of the VPC's two private subnets, in subnet order (network.ts). */
const subnetIds = (t: Template): string[] => Object.keys(t.findResources('AWS::EC2::Subnet')).sort();
/** The logical id of the security group whose construct path starts with `prefix` (NetworkCallers, NetworkEndpoints). */
const groupId = (t: Template, prefix: string): string => {
  const ids = Object.keys(t.findResources('AWS::EC2::SecurityGroup')).filter((id) => id.startsWith(prefix));
  expect(ids).toHaveLength(1);
  return ids[0];
};
/** True when one statement grants `action` on a resource whose JSON contains `resourcePart`. */
const grants = (statements: any[], action: string, resourcePart: string) =>
  statements.some((s) => actionsOf(s).includes(action) && JSON.stringify(s.Resource).includes(resourcePart));

const REPO_ROOT = path.resolve(__dirname, '..', '..');
/** A distribution name as uv writes it (PEP 503): lower case, runs of `-`, `_` and `.` as one `-`. */
const normalized = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

/**
 * The pins of a requirements file compiled by `uv pip compile --generate-hashes`, the format the zips
 * are built from with --require-hashes: `name==version \` followed by one `--hash=sha256:… \` line per
 * distribution of that version, then `# via …` comments. Names are normalized; `hashed` says whether
 * every pin carries at least one hash (what the installer insists on).
 */
function requirementPins(file: string): { pins: Record<string, string>; hashed: boolean } {
  const lines = fs
    .readFileSync(path.join(REPO_ROOT, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const pins: Record<string, string> = {};
  const hashes: Record<string, number> = {};
  let current = '';
  for (const line of lines) {
    const pin = line.match(/^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?==(\S+?)\s*\\?$/);
    if (pin) {
      current = normalized(pin[1]);
      pins[current] = pin[2];
      hashes[current] = 0;
    } else if (/^--hash=sha256:[0-9a-f]{64}\s*\\?$/.test(line) && current) {
      hashes[current] += 1;
    } else {
      throw new Error(`${file}: not a pin or a hash: ${JSON.stringify(line)}`);
    }
  }
  const names = Object.keys(pins);
  return { pins, hashed: names.length > 0 && names.every((n) => hashes[n] > 0) };
}
/** The three requirement files the zips are built from (bundling.ts, agents.ts). */
const AGENT_REQUIREMENTS = 'backend/agentcore/requirements.txt';
const LAKE_AGENT_REQUIREMENTS = 'backend/agentcore-lake/requirements.txt';

describe('MultimodalAiKnowledgeGraphStack', () => {
  test('creates a Neptune Analytics graph with a 1024-dim vector index and no replica, reachable only through a private endpoint', () => {
    const t = synth();
    t.hasResourceProperties('AWS::NeptuneGraph::Graph', {
      ProvisionedMemory: 16,
      ReplicaCount: 0,
      PublicConnectivity: false,
      VectorSearchConfiguration: { VectorSearchDimension: 1024 },
    });
    // one private graph endpoint, in both private subnets, behind the Endpoints group
    t.resourceCountIs('AWS::NeptuneGraph::PrivateGraphEndpoint', 1);
    const endpoint = oneOf(t, 'AWS::NeptuneGraph::PrivateGraphEndpoint').Properties;
    expect(endpoint.GraphIdentifier).toEqual({ 'Fn::GetAtt': [logicalId(t, 'AWS::NeptuneGraph::Graph'), 'GraphId'] });
    expect(endpoint.VpcId).toEqual({ Ref: logicalId(t, 'AWS::EC2::VPC') });
    expect(endpoint.SubnetIds).toEqual(subnetIds(t).map((id) => ({ Ref: id })));
    expect(endpoint.SecurityGroupIds).toEqual([{ 'Fn::GetAtt': [groupId(t, 'NetworkEndpoints'), 'GroupId'] }]);
  });

  test('the function URL takes IAM-signed requests only, from the site origin, and nothing else may reach the API', () => {
    const t = synth();
    const urls = Object.values(t.findResources('AWS::Lambda::Url')) as any[];
    expect(urls).toHaveLength(1);
    const url = urls[0].Properties;
    expect(url.AuthType).toBe('AWS_IAM');
    expect(url.TargetFunctionArn).toEqual({ 'Fn::GetAtt': [logicalIdOfFn(t, API), 'Arn'] });
    // CORS: exactly the distribution's origin, the two methods the app sends, the SigV4 headers, no cookies
    expect(url.Cors.AllowOrigins).toEqual([{ 'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [logicalId(t, 'AWS::CloudFront::Distribution'), 'DomainName'] }]] }]);
    expect(url.Cors.AllowMethods).toEqual(['GET', 'POST']);
    expect(url.Cors.AllowHeaders.sort()).toEqual(['accept', 'authorization', 'content-type', 'x-amz-content-sha256', 'x-amz-date', 'x-amz-security-token']);
    expect(url.Cors.AllowCredentials).toBe(false);
    // no resource policy opens the function to anyone (no CloudFront OAC, no public URL), and CloudFront has no /api/* behavior
    for (const perm of Object.values(t.findResources('AWS::Lambda::Permission')) as any[]) {
      expect(perm.Properties.FunctionName).not.toEqual({ 'Fn::GetAtt': [logicalIdOfFn(t, API), 'Arn'] });
    }
    const config = (Object.values(t.findResources('AWS::CloudFront::Distribution'))[0] as any).Properties.DistributionConfig;
    expect(config.CacheBehaviors).toBeUndefined();
    expect(config.Origins).toHaveLength(1);
    t.resourceCountIs('AWS::CloudFront::OriginRequestPolicy', 0);
    const oacs = Object.values(t.findResources('AWS::CloudFront::OriginAccessControl')) as any[];
    expect(oacs.map((o) => o.Properties.OriginAccessControlConfig.OriginAccessControlOriginType)).toEqual(['s3']);
  });

  test('lambda roles are scoped to the graph and to Bedrock InvokeModel', () => {
    const t = synth();
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['neptune-graph:ReadDataViaQuery', 'neptune-graph:WriteDataViaQuery']),
            Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('Graph'), 'GraphArn'] },
          }),
          Match.objectLike({ Action: 'bedrock:InvokeModel' }),
        ]),
      }),
    });
  });

  test('loads the graph at deploy time through a custom resource that depends on the graph and on the ontologies deployment', () => {
    const t = synth();
    t.resourceCountIs('Custom::GraphLoader', 1);
    const loader = Object.values(t.findResources('Custom::GraphLoader'))[0] as any;
    expect(loader.DependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/^Graph/)]));
    // the loader reads the data sets from the data bucket, where OntologiesDeploy puts them
    const ontologiesDeploy = Object.entries(t.findResources('Custom::CDKBucketDeployment')).filter(
      ([, d]: [string, any]) => d.Properties.DestinationBucketKeyPrefix === 'ontologies/',
    );
    expect(ontologiesDeploy).toHaveLength(1);
    expect(ontologiesDeploy[0][0]).toMatch(/^OntologiesDeploy/);
    expect(loader.DependsOn).toContain(ontologiesDeploy[0][0]);
  });

  test('the API role only reads the graph; write and delete come with allowWriteQueries only', () => {
    const graphActions = (t: Template, handler: string) =>
      roleStatements(t, handler).flatMap(actionsOf).filter((a) => a.startsWith('neptune-graph:')).sort();
    const t = synth();
    expect(graphActions(t, API)).toEqual(['neptune-graph:GetGraph', 'neptune-graph:GetGraphSummary', 'neptune-graph:ReadDataViaQuery']);
    // the pipeline and the loader write the graph with their own roles
    for (const handler of [PIPELINE, LOADER]) {
      expect(graphActions(t, handler)).toEqual(expect.arrayContaining(['neptune-graph:WriteDataViaQuery', 'neptune-graph:DeleteDataViaQuery']));
    }
    expect(fnByHandler(t, API).Properties.Environment.Variables.ALLOW_WRITE_QUERIES).toBe('false');
    const writable = synth({ allowWriteQueries: true });
    expect(graphActions(writable, API)).toEqual(expect.arrayContaining(['neptune-graph:WriteDataViaQuery', 'neptune-graph:DeleteDataViaQuery']));
    expect(fnByHandler(writable, API).Properties.Environment.Variables.ALLOW_WRITE_QUERIES).toBe('true');
  });

  test('the log viewer is off by default: no log read on the API role, EXPLORER_LOGS=false', () => {
    const t = synth();
    expect(fnByHandler(t, API).Properties.Environment.Variables.EXPLORER_LOGS).toBe('false');
    expect(roleStatements(t, API).flatMap(actionsOf)).not.toContain('logs:FilterLogEvents');
  });

  test('ontologies live in their own bucket; the API reads it and, with explorerLogs, its own log group', () => {
    const t = synth({ explorerLogs: true });
    expect(fnByHandler(t, API).Properties.Environment.Variables.EXPLORER_LOGS).toBe('true');
    t.resourceCountIs('AWS::S3::Bucket', 3); // site + ontologies + access logs
    // the data bucket's name starts like the sign-in secret's, so the workshop's participant policy
    // can scope its S3 reads to it (arn:aws:s3:::multimodal-ai-knowledge-graph-*)
    expect(t.findResources('AWS::S3::Bucket')[dataBucketId(t)].Properties.BucketName).toBe(
      'multimodal-ai-knowledge-graph-data-111111111111-us-east-1',
    );
    t.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'ontology_rag.lambda_handler.api_handler',
      Environment: {
        Variables: Match.objectLike({
          ONTOLOGIES_BUCKET: { Ref: Match.stringLikeRegexp('^OntologiesBucket') },
          ONTOLOGIES_PREFIX: 'ontologies/',
        }),
      },
    });
    // the repo folder is uploaded by a BucketDeployment under ontologies/
    t.hasResourceProperties('Custom::CDKBucketDeployment', {
      DestinationBucketKeyPrefix: 'ontologies/',
      Prune: true,
      DestinationBucketName: { Ref: Match.stringLikeRegexp('^OntologiesBucket') },
    });
    const statements = Object.values(t.findResources('AWS::IAM::Policy'))
      .flatMap((p: any) => p.Properties.PolicyDocument.Statement)
      .map((s: any) => JSON.stringify(s));
    expect(statements.some((s) => s.includes('logs:FilterLogEvents') && s.includes('ApiLogs'))).toBe(true);
    expect(statements.some((s) => s.includes('s3:GetObject') && s.includes('OntologiesBucket'))).toBe(true);
    // the log read is scoped to the API's own log group, never to logs:* on "*"
    expect(statements.some((s) => s.includes('logs:FilterLogEvents') && s.includes('"Resource":"*"'))).toBe(false);
    // and it is the one read the backend makes (telemetry.py, filter_log_events): no GetLogEvents, no DescribeLogStreams
    const logReads = roleStatements(t, API)
      .flatMap(actionsOf)
      .filter((a) => a.startsWith('logs:') && a !== 'logs:CreateLogStream' && a !== 'logs:PutLogEvents');
    expect(logReads).toEqual(['logs:FilterLogEvents']);
    const backendDir = path.join(REPO_ROOT, 'backend', 'src', 'ontology_rag');
    const backend = fs
      .readdirSync(backendDir)
      .filter((f) => f.endsWith('.py'))
      .map((f) => fs.readFileSync(path.join(backendDir, f), 'utf8'))
      .join('\n');
    expect(backend).toContain('.filter_log_events(');
    expect(backend).not.toMatch(/\.(get_log_events|describe_log_streams)\(/);
  });

  test('lambda env points at the ontologies folder and lists the vision models', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          ONTOLOGIES_DIR: '/var/task/ontologies',
          ONTOLOGY_PATH: '/var/task/ontologies/fashion/fashion.ttl',
          LLM_MODEL_ID: 'global.anthropic.claude-sonnet-5-5',
          VISION_MODEL_IDS: DEFAULT_VISION_MODEL_IDS.join(','),
        }),
      },
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ VISION_MODEL_IDS: Match.stringLikeRegexp('claude-opus-5-5,.*haiku-5-5.*gpt-6\\.1-sol.*grok-4\\.7.*kimi-k3') }) },
    });
  });

  test('only the loader mirrors the data sets\' data files (MIRROR_SAMPLE_DATA); no function names a sample data folder', () => {
    const t = synth();
    const fns = Object.values(t.findResources('AWS::Lambda::Function')) as any[];
    const env = (fn: any) => fn.Properties.Environment?.Variables ?? {};
    expect(fns.filter((fn) => 'SAMPLE_DATA_DIR' in env(fn))).toEqual([]);
    const mirroring = fns.filter((fn) => 'MIRROR_SAMPLE_DATA' in env(fn));
    expect(mirroring.map((fn) => fn.Properties.Handler)).toEqual([LOADER]);
    expect(env(mirroring[0]).MIRROR_SAMPLE_DATA).toBe('true');
  });

  test('a slow API call ends with the API\'s own error: the function 115 s, a model or agent call 100 s', () => {
    // The backend's numbers, read from its source: one call the API waits for, and its connection.
    const vision = fs.readFileSync(path.join(REPO_ROOT, 'backend', 'src', 'ontology_rag', 'vision.py'), 'utf8');
    const backendSeconds = (name: string) => Number(vision.match(new RegExp(`^${name} = (\\d+)$`, 'm'))?.[1]);
    const call = backendSeconds('API_CALL_TIMEOUT_S');
    const connect = backendSeconds('CONNECT_TIMEOUT_S');
    expect([call, connect]).toEqual([100, 5]);
    const t = synth();
    const fn = fnByHandler(t, API).Properties;
    expect(fn.Timeout).toBe(API_FUNCTION_TIMEOUT_S);
    expect(API_FUNCTION_TIMEOUT_S).toBe(115);
    // the call stops before the function does, with room for the work around it
    expect(connect + call).toBeLessThanOrEqual(API_FUNCTION_TIMEOUT_S - 10);
  });

  test('the query console stays read-only by default', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'ontology_rag.lambda_handler.api_handler',
      Environment: { Variables: Match.objectLike({ ALLOW_WRITE_QUERIES: 'false' }) },
    });
  });

  test('CloudFront passes the API error statuses through: no custom error responses', () => {
    // Custom error responses are distribution-wide: 401/403/404 from the API would come back as
    // index.html with status 200. The app has no client-side routing, so there is nothing to rescue.
    const dist = Object.values(synth().findResources('AWS::CloudFront::Distribution'))[0] as any;
    expect(dist.Properties.DistributionConfig.CustomErrorResponses).toBeUndefined();
    expect(dist.Properties.DistributionConfig.DefaultRootObject).toBe('index.html');
  });

  test('the ingest pipeline is a Step Functions state machine defined inline that invokes the pipeline function', () => {
    const t = synth();
    t.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    const sm = Object.values(t.findResources('AWS::StepFunctions::StateMachine'))[0] as any;
    // inline definition (no S3 asset); CloudFormation replaces the ${PipelineFunctionArn}
    // placeholder from DefinitionSubstitutions at deploy time
    expect(sm.Properties.DefinitionS3Location).toBeUndefined();
    const definition = sm.Properties.DefinitionString as string;
    expect(typeof definition).toBe('string');
    expect(definition).toContain('"QueryLanguage": "JSONata"');
    expect(definition).toContain('RetryableError');
    expect(definition).toContain('${PipelineFunctionArn}');
    expect(JSON.stringify(sm.Properties.DefinitionSubstitutions.PipelineFunctionArn)).toMatch(/PipelineFunction.*Arn/);
    t.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'ontology_rag.lambda_handler.pipeline_handler',
      Timeout: 360, // an ingest step needs 300 s; the trends graph agent's job, 360 (PIPELINE_FUNCTION_TIMEOUT_S)
      Environment: { Variables: Match.objectLike({ GRAPH_BACKEND: 'neptune' }) },
    });
    // the API knows the state machine and can start / describe executions; nothing else can
    t.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'ontology_rag.lambda_handler.api_handler',
      Environment: {
        Variables: Match.objectLike({
          PIPELINE_STATE_MACHINE_ARN: { Ref: Match.stringLikeRegexp('^IngestPipeline') },
          PIPELINE_FUNCTION_NAME: { Ref: Match.stringLikeRegexp('^PipelineFunction') },
        }),
      },
    });
    const statements = Object.values(t.findResources('AWS::IAM::Policy'))
      .flatMap((p: any) => p.Properties.PolicyDocument.Statement)
      .map((s: any) => JSON.stringify(s));
    expect(statements.some((s) => s.includes('states:StartExecution') && s.includes('IngestPipeline'))).toBe(true);
    expect(statements.some((s) => s.includes('states:DescribeExecution') && s.includes('IngestPipeline'))).toBe(true);
    expect(statements.some((s) => s.includes('lambda:InvokeFunction') && s.includes('PipelineFunction'))).toBe(true);
    // uploads and run records: short-lived prefixes in the data bucket
    t.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Prefix: 'uploads/', ExpirationInDays: 1 }),
          Match.objectLike({ Prefix: 'runs/', ExpirationInDays: 7 }),
        ]),
      },
    });
    expect(statements.some((s) => s.includes('s3:PutObject') && s.includes('uploads/*'))).toBe(true);
    t.resourceCountIs('AWS::S3::Bucket', 3); // still site + data + access logs: no extra bucket for the pipeline
  });

  test('Step Functions may assume the pipeline role only for a state machine of this account and Region, and the role keeps its grants', () => {
    const t = synth();
    const sm = Object.values(t.findResources('AWS::StepFunctions::StateMachine'))[0] as any;
    const roleId = sm.Properties.RoleArn['Fn::GetAtt'][0];
    const role = t.findResources('AWS::IAM::Role')[roleId];
    // aws:SourceAccount and aws:SourceArn: the confused-deputy guard, as on the AgentCore roles
    expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([
      {
        Action: 'sts:AssumeRole',
        Effect: 'Allow',
        Principal: { Service: 'states.amazonaws.com' },
        Condition: {
          StringEquals: { 'aws:SourceAccount': '111111111111' },
          ArnLike: {
            'aws:SourceArn': { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':states:us-east-1:111111111111:stateMachine:*']] },
          },
        },
      },
    ]);
    expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    // what the role did before it was declared here: invoke the pipeline function, deliver logs, trace
    const statements = Object.values(t.findResources('AWS::IAM::Policy'))
      .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
      .flatMap((p: any) => p.Properties.PolicyDocument.Statement);
    const pipelineFnId = Object.keys(t.findResources('AWS::Lambda::Function', { Properties: { Handler: PIPELINE } }))[0];
    const invoke = statements.filter((s) => actionsOf(s).includes('lambda:InvokeFunction'));
    expect(invoke).toHaveLength(1);
    expect(invoke[0].Resource).toEqual([
      { 'Fn::GetAtt': [pipelineFnId, 'Arn'] },
      { 'Fn::Join': ['', [{ 'Fn::GetAtt': [pipelineFnId, 'Arn'] }, ':*']] },
    ]);
    const actions = statements.flatMap(actionsOf);
    for (const action of ['logs:CreateLogDelivery', 'logs:PutResourcePolicy', 'logs:DescribeLogGroups', 'xray:PutTraceSegments', 'xray:GetSamplingTargets']) {
      expect(actions).toContain(action);
    }
    // the state machine waits for the role's policy, so its first execution can already log and invoke
    expect(sm.DependsOn).toEqual(expect.arrayContaining([roleId, expect.stringMatching(/^IngestPipelineRoleDefaultPolicy/)]));
  });

  test("the trends graph agent's job: the API invokes the pipeline function (that one, unqualified), both write jobs/trends/ only", () => {
    const t = synth();
    const fnId = (handler: string) =>
      Object.entries(t.findResources('AWS::Lambda::Function')).find(([, r]: [string, any]) => r.Properties.Handler === handler)![0];
    const pipelineArn = { 'Fn::GetAtt': [fnId(PIPELINE), 'Arn'] };
    // lambda:InvokeFunction on the unqualified ARN only: no version, no alias, no wildcard for cdk-nag to flag
    const invokes = roleStatements(t, API).filter((s) => actionsOf(s).some((a) => a.startsWith('lambda:')));
    expect(invokes).toEqual([{ Action: 'lambda:InvokeFunction', Effect: 'Allow', Resource: pipelineArn }]);
    for (const handler of [PIPELINE, LOADER]) {
      expect(roleStatements(t, handler).some((s) => actionsOf(s).some((a) => a.startsWith('lambda:')))).toBe(false);
    }
    expect(fnByHandler(t, API).Properties.Environment.Variables.PIPELINE_FUNCTION_NAME).toEqual({ Ref: fnId(PIPELINE) });
    // the API writes the record, the pipeline function its progress and result; the loader neither
    for (const handler of [API, PIPELINE]) expect(grants(roleStatements(t, handler), 's3:PutObject', '/jobs/trends/*')).toBe(true);
    expect(grants(roleStatements(t, LOADER), 's3:PutObject', '/jobs/')).toBe(false);
    // the records are read for minutes and kept a day, like the uploads
    t.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Prefix: 'jobs/', ExpirationInDays: 1 })]) },
    });
    // the backend's side: the same prefix, and a job runs for at most the pipeline function's timeout
    const jobsPy = fs.readFileSync(path.join(REPO_ROOT, 'backend', 'src', 'ontology_rag', 'jobs.py'), 'utf8');
    expect(jobsPy).toContain('TREND_RECORDS = "jobs/trends/"');
    expect(Number(jobsPy.match(/^ {4}RUN_S = (\d+)/m)?.[1])).toBe(fnByHandler(t, PIPELINE).Properties.Timeout);
    // the graph agent's job is the only one the pipeline function runs for the API (October's decompose job is gone)
    const handlerPy = fs.readFileSync(path.join(REPO_ROOT, 'backend', 'src', 'ontology_rag', 'lambda_handler.py'), 'utf8');
    expect(handlerPy).toContain('if step == trends.GRAPH_STEP:');
    expect(handlerPy).not.toMatch(/decompose/i);
  });

  describe('the product catalog on Amazon S3 Vectors', () => {
    let sample: Template;
    beforeAll(() => {
      sample = synth();
    });
    const indexIds = (t: Template) => {
      const ids = Object.entries(t.findResources('AWS::S3Vectors::Index'));
      const named = (name: string) => ids.find(([, r]: [string, any]) => r.Properties.IndexName === name)![0];
      return { catalog: named('catalog') };
    };
    const vectorStatements = (t: Template, handler: string) =>
      roleStatements(t, handler).filter((s) => actionsOf(s).some((a) => a.startsWith('s3vectors:')));

    test('one vector bucket and its "catalog" index (1024-dim float32, cosine), deleted with the stack', () => {
      const t = sample;
      t.resourceCountIs('AWS::S3Vectors::VectorBucket', 1);
      t.resourceCountIs('AWS::S3Vectors::Index', 1);
      const bucketId = logicalId(t, 'AWS::S3Vectors::VectorBucket');
      // the logical id stays CatalogIndex: renaming or changing it would replace the index
      expect(indexIds(t).catalog).toMatch(/^CatalogIndex/);
      t.hasResourceProperties('AWS::S3Vectors::Index', {
        IndexName: 'catalog',
        DataType: 'float32',
        Dimension: 1024,
        DistanceMetric: 'cosine',
        // the keys payoff.index_catalog writes and never filters on
        MetadataConfiguration: { NonFilterableMetadataKeys: ['name', 'text'] },
        // the GetAtt makes CloudFormation create the bucket first (and delete it last)
        VectorBucketArn: { 'Fn::GetAtt': [bucketId, 'VectorBucketArn'] },
      });
      // CloudFormation names the vector bucket (unique per stack)
      expect(t.findResources('AWS::S3Vectors::VectorBucket')[bucketId].Properties?.VectorBucketName).toBeUndefined();
      for (const type of ['AWS::S3Vectors::VectorBucket', 'AWS::S3Vectors::Index']) {
        for (const r of Object.values(t.findResources(type)) as any[]) {
          expect([r.DeletionPolicy, r.UpdateReplacePolicy]).toEqual(['Delete', 'Delete']);
        }
      }
      // the index follows the embedding dimension
      const small = synth({ embeddingDimension: 384 }).findResources('AWS::S3Vectors::Index');
      expect(Object.values(small).map((r: any) => r.Properties.Dimension)).toEqual([384]);
    });

    test('the API reads the catalog; the loader only writes it; the pipeline never calls S3 Vectors', () => {
      const t = sample;
      const catalogArn = { 'Fn::GetAtt': [indexIds(t).catalog, 'IndexArn'] };
      const on = (statements: any[], arn: any) => statements.filter((s) => JSON.stringify(s.Resource) === JSON.stringify(arn));
      const api = on(vectorStatements(t, API), catalogArn);
      expect(api).toHaveLength(1);
      expect(api[0].Effect).toBe('Allow');
      expect(actionsOf(api[0]).sort()).toEqual(['s3vectors:GetIndex', 's3vectors:GetVectors', 's3vectors:ListVectors', 's3vectors:QueryVectors']);
      const loader = on(vectorStatements(t, LOADER), catalogArn);
      expect(loader).toHaveLength(1);
      expect(actionsOf(loader[0])).toEqual(['s3vectors:PutVectors']);
      expect(vectorStatements(t, PIPELINE)).toEqual([]);
      // no s3vectors grant anywhere else, and never on "*": the API's one and the loader's one
      const all = Object.values(t.findResources('AWS::IAM::Policy'))
        .flatMap((p: any) => p.Properties.PolicyDocument.Statement)
        .filter((s: any) => actionsOf(s).some((a) => a.startsWith('s3vectors:')));
      expect(all).toHaveLength(2);
      expect(all.every((s: any) => s.Resource !== '*')).toBe(true);
      // the loader fills the index, so it runs once it exists
      const graphLoader: any = Object.values(t.findResources('Custom::GraphLoader'))[0];
      expect(graphLoader.DependsOn).toEqual(expect.arrayContaining([indexIds(t).catalog]));
    });

    test('no document store in the data bucket: nothing writes under rag/, nothing deletes from it, the loader only reads it', () => {
      const t = sample;
      const api = roleStatements(t, API);
      const pipeline = roleStatements(t, PIPELINE);
      const loader = roleStatements(t, LOADER);
      for (const fn of [api, pipeline, loader]) {
        expect(grants(fn, 's3:PutObject', '/rag/*')).toBe(false);
        expect(fn.some((s) => actionsOf(s).some((a) => a.startsWith('s3:Delete')))).toBe(false);
      }
      expect(grants(api, 's3:GetObject*', 'OntologiesBucket')).toBe(true); // read (whole bucket) as before
      expect(grants(api, 's3:PutObject', '/uploads/*')).toBe(true);
      expect(grants(pipeline, 's3:PutObject', '/runs/*')).toBe(true);
      expect(loader.some((s) => actionsOf(s).includes('s3:PutObject'))).toBe(false);
      const bucket = t.findResources('AWS::S3::Bucket')[dataBucketId(t)];
      const prefixes = bucket.Properties.LifecycleConfiguration.Rules.map((r: any) => r.Prefix);
      expect(prefixes).toEqual(['uploads/', 'runs/', 'jobs/']); // jobs/: the records of the trends graph agent's jobs
    });
    test('the env names the vector bucket and the catalog index for the API and the loader only', () => {
      const t = sample;
      const models = DEFAULT_VISION_MODEL_IDS;
      const bucketId = logicalId(t, 'AWS::S3Vectors::VectorBucket');
      // the vector bucket's Ref / ARN is arn:aws:s3vectors:<region>:<account>:bucket/<name>
      const bucketName = { 'Fn::Select': [1, { 'Fn::Split': ['/', { 'Fn::GetAtt': [bucketId, 'VectorBucketArn'] }] }] };
      for (const handler of [API, LOADER, PIPELINE]) {
        const env = fnByHandler(t, handler).Properties.Environment.Variables;
        expect(env.VECTOR_BUCKET).toEqual(handler === PIPELINE ? undefined : bucketName);
        expect(env.CATALOG_INDEX).toBe(handler === PIPELINE ? undefined : 'catalog');
        expect(env.DOCUMENTS_INDEX).toBeUndefined();
        expect(env.VECTOR_INDEX).toBeUndefined();
        expect(env.AUTO_LOAD_SAMPLE).toBeUndefined(); // nothing reads it since local mode went
      }
      const env = fnByHandler(t, API).Properties.Environment.Variables;
      // default: the vision model list
      expect(env.ANSWER_MODEL_IDS).toBe(models.join(','));
      expect(models).toContain(env.LLM_MODEL_ID); // the default answer model is offered
      // the pipeline function runs the trends graph agent's job, whose model comes from the same list
      expect(fnByHandler(t, PIPELINE).Properties.Environment.Variables.ANSWER_MODEL_IDS).toBe(models.join(','));
      expect(fnByHandler(t, LOADER).Properties.Environment.Variables.ANSWER_MODEL_IDS).toBeUndefined();
      const custom = synth({ answerModelIds: ['us.amazon.nova-pro-v1:0'] });
      for (const handler of [API, PIPELINE]) {
        expect(fnByHandler(custom, handler).Properties.Environment.Variables.ANSWER_MODEL_IDS).toBe('us.amazon.nova-pro-v1:0');
      }
    });

    test('the vector bucket and its index are stack outputs; a vector bucket is not an S3 bucket', () => {
      sample.resourceCountIs('AWS::S3::Bucket', 3);
      for (const name of ['VectorBucketName', 'CatalogIndexArn']) {
        expect(sample.findOutputs(name)).not.toEqual({});
      }
      expect(sample.findOutputs('CatalogIndexArn').CatalogIndexArn.Value).toEqual({ 'Fn::GetAtt': [indexIds(sample).catalog, 'IndexArn'] });
      expect(sample.findOutputs('DocumentsIndexArn')).toEqual({});
    });
    test('the data sets\' photos reach the data bucket with the ontologies (under ontologies/), not through a deployment of their own', () => {
      expect(Object.keys(sample.toJSON().Resources).filter((id) => id.startsWith('SampleImages'))).toEqual([]);
      const deployments = Object.values(sample.findResources('Custom::CDKBucketDeployment')) as any[];
      const toData = deployments.filter((d) => JSON.stringify(d.Properties.DestinationBucketName) === JSON.stringify({ Ref: dataBucketId(sample) }));
      expect(toData.map((d) => d.Properties.DestinationBucketKeyPrefix)).toEqual(['ontologies/']);
      expect(toData[0].Properties.Prune).not.toBe(false);
    });

    test('the Lambda bundle vendors boto3 >= 1.43 (s3vectors client) with its whole dependency closure, pinned and hashed', () => {
      const { pins, hashed } = requirementPins(LAMBDA_REQUIREMENTS);
      expect(hashed).toBe(true); // installed with --require-hashes (bundling.ts)
      for (const pkg of ['boto3', 'botocore']) {
        const [major, minor] = pins[pkg].split('.').map(Number);
        expect(major > 1 || (major === 1 && minor >= 43)).toBe(true);
      }
      expect(pins.boto3).toBe(pins.botocore); // boto3 pins botocore to its own release
      for (const dep of ['s3transfer', 'jmespath', 'python-dateutil', 'six', 'urllib3']) {
        expect(pins[dep]).toBeDefined(); // installed with --no-deps, so every dependency is listed
      }
      // one boto3 everywhere: the Lambda zip and the two agent zips (THIRD-PARTY-LICENSES names one version)
      for (const file of [AGENT_REQUIREMENTS, LAKE_AGENT_REQUIREMENTS]) {
        expect(requirementPins(file).pins.boto3).toBe(pins.boto3);
      }
    });
  });

  describe('query agent on Amazon Bedrock AgentCore Runtime (tab 2)', () => {
    const RUNTIME = 'AWS::BedrockAgentCore::Runtime';
    let sample: Template;
    beforeAll(() => {
      sample = synth();
    });
    /** The query agent's runtime (the stack has the lake agent's too). */
    const runtimeOf = (t: Template, prefix = 'QueryAgentRuntime'): [string, any] => {
      const ids = Object.keys(t.findResources(RUNTIME)).filter((id) => id.startsWith(prefix));
      expect(ids).toHaveLength(1);
      return [ids[0], t.findResources(RUNTIME)[ids[0]]];
    };
    /** The statements of the runtime's execution role, minus the L2's logs / X-Ray / metrics defaults. */
    const agentStatements = (t: Template, prefix = 'QueryAgentRuntime'): any[] => {
      const roleId = runtimeOf(t, prefix)[1].Properties.RoleArn['Fn::GetAtt'][0];
      return Object.values(t.findResources('AWS::IAM::Policy'))
        .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
        .flatMap((p: any) => p.Properties.PolicyDocument.Statement);
    };

    test("one HTTP runtime from a Python 3.14 code zip, started through ADOT, in the stack's VPC", () => {
      const t = sample;
      t.resourceCountIs(RUNTIME, 2); // the query agent and the lake agent (the trends question)
      const props = runtimeOf(t)[1].Properties;
      expect(props.AgentRuntimeArtifact.ContainerConfiguration).toBeUndefined(); // no image, no ECR
      const code = props.AgentRuntimeArtifact.CodeConfiguration;
      expect(code.Runtime).toBe('PYTHON_3_14');
      expect(code.EntryPoint).toEqual(['opentelemetry-instrument', 'main.py']);
      expect(props.ProtocolConfiguration).toBe('HTTP');
      // both agents: VPC mode in the private subnets with the Callers group, created once the VPC
      // has egress (the S3 gateway endpoint, the internet gateway attached, both routes to the NAT gateway)
      const routes = Object.keys(t.findResources('AWS::EC2::Route'));
      expect(routes).toHaveLength(2);
      for (const prefix of ['QueryAgentRuntime', 'LakeAgentRuntime']) {
        const [, runtime] = runtimeOf(t, prefix);
        expect(runtime.Properties.NetworkConfiguration).toEqual({
          NetworkMode: 'VPC',
          NetworkModeConfig: {
            SecurityGroups: [{ 'Fn::GetAtt': [groupId(t, 'NetworkCallers'), 'GroupId'] }],
            Subnets: subnetIds(t).map((id) => ({ Ref: id })),
          },
        });
        expect(runtime.DependsOn).toEqual(
          expect.arrayContaining([logicalId(t, 'AWS::EC2::VPCEndpoint'), logicalId(t, 'AWS::EC2::VPCGatewayAttachment'), ...routes]),
        );
      }
      expect(props.AuthorizerConfiguration).toBeUndefined(); // IAM (SigV4) callers only
      // one session per browser tab: 10 minutes idle, 2 hours at most
      expect(props.LifecycleConfiguration).toEqual({ IdleRuntimeSessionTimeout: 600, MaxLifetime: 7200 });
      // no X-Ray trace delivery by default: it needs CloudWatch Transaction Search in the account
      t.resourceCountIs('AWS::Logs::Delivery', 0);
      t.resourceCountIs('AWS::XRay::ResourcePolicy', 0);
      // ... and ADOT drops its spans (the X-Ray OTLP endpoint would refuse them)
      expect(runtimeOf(sample)[1].Properties.EnvironmentVariables.OTEL_TRACES_EXPORTER).toBe('none');
      // Daft (the S3 Tables MCP server's engine) sends usage pings unless opted out
      expect(runtimeOf(sample, 'LakeAgentRuntime')[1].Properties.EnvironmentVariables.DO_NOT_TRACK).toBe('true');
      const traced = synth({ agentTracing: true });
      traced.hasResourceProperties('AWS::Logs::DeliveryDestination', { DeliveryDestinationType: 'XRAY' });
      traced.hasResourceProperties('AWS::Logs::DeliverySource', { LogType: 'TRACES' });
      expect(runtimeOf(traced)[1].Properties.EnvironmentVariables.OTEL_TRACES_EXPORTER).toBeUndefined();
      // the code zip: a CDK asset in the bootstrap bucket
      expect(JSON.stringify(runtimeOf(sample)[1].Properties.AgentRuntimeArtifact)).toContain('cdk-hnb659fds-assets');
    });

    test('the runtime serves the stack graph with the API model list and a deadline under the API timeout', () => {
      const t = sample;
      const models = DEFAULT_VISION_MODEL_IDS;
      const env = runtimeOf(t)[1].Properties.EnvironmentVariables;
      expect(env.GRAPH_ID).toEqual({ 'Fn::GetAtt': [logicalId(t, 'AWS::NeptuneGraph::Graph'), 'GraphId'] });
      expect(env.ANSWER_MODEL_IDS).toBe(models.join(','));
      expect(env.ANSWER_MODEL_IDS).toBe(fnByHandler(t, API).Properties.Environment.Variables.ANSWER_MODEL_IDS);
      expect(env.LLM_MODEL_ID).toBe('global.anthropic.claude-sonnet-5-5');
      expect(Number(env.AGENT_DEADLINE_S)).toBe(AGENT_DEADLINE_S);
      // the API waits 100 s for the agent (vision.API_CALL_TIMEOUT_S): 30 s for the last
      // turn's tool calls, a new session's first start and the way back
      expect(AGENT_DEADLINE_S).toBe(70);
      expect(AGENT_DEADLINE_S + 30).toBeLessThanOrEqual(100);
      // V2 limits a code deployment's environment to 1.5 KB
      expect(JSON.stringify(env).length).toBeLessThan(1536);
    });

    test('platform version V2 where AgentCore offers it, the service default elsewhere', () => {
      expect(runtimeOf(sample)[1].Properties.PlatformVersion).toBe('V2'); // us-east-1
      expect(AGENT_V2_REGIONS).not.toContain('eu-central-1');
      const elsewhere = synth({ env: { account: '111111111111', region: 'eu-central-1' } });
      expect(runtimeOf(elsewhere)[1].Properties.PlatformVersion).toBeUndefined(); // service default
      const pinned = synth({ agentPlatformVersion: 'V1' });
      expect(runtimeOf(pinned)[1].Properties.PlatformVersion).toBe('V1');
      // a stack without a Region (bin/app.ts always binds one) leaves the version to the service,
      // and needs its two AZ IDs named (nothing is looked up at synth)
      expect(runtimeOf(synth({ env: undefined, vpcAzIds: ['use1-az1', 'use1-az2'] }))[1].Properties.PlatformVersion).toBeUndefined();
      expect(() => synth({ env: undefined })).toThrow(/-c vpcAzIds=/);
      expect(sample.toJSON().Conditions).toBeUndefined();
    });

    test('the execution role may read the graph and call the answer models, nothing more', () => {
      const t = sample;
      const [runtimeId] = runtimeOf(t);
      const roleId = runtimeOf(t)[1].Properties.RoleArn['Fn::GetAtt'][0];
      const trust = t.findResources('AWS::IAM::Role')[roleId].Properties.AssumeRolePolicyDocument.Statement;
      expect(trust).toHaveLength(1);
      expect(trust[0].Principal).toEqual({ Service: 'bedrock-agentcore.amazonaws.com' });
      expect(trust[0].Condition.StringEquals['aws:SourceAccount']).toBeDefined();
      const statements = agentStatements(t);
      const graph = statements.filter((s) => actionsOf(s).some((a) => a.startsWith('neptune-graph:')));
      expect(graph).toHaveLength(1);
      expect(actionsOf(graph[0])).toEqual(['neptune-graph:ReadDataViaQuery']);
      expect(graph[0].Resource).toEqual({ 'Fn::GetAtt': [logicalId(t, 'AWS::NeptuneGraph::Graph'), 'GraphArn'] });
      const models = statements.filter((s) => actionsOf(s).some((a) => a.startsWith('bedrock:Invoke')));
      expect(models).toHaveLength(1);
      expect(actionsOf(models[0])).toEqual(['bedrock:InvokeModel']);
      // the only other Bedrock action: the guardrail on the typed question
      const others = statements.filter((s) => actionsOf(s).some((a) => a.startsWith('bedrock:') && !a.startsWith('bedrock:Invoke')));
      expect(others.flatMap(actionsOf)).toEqual(['bedrock:ApplyGuardrail']);
      // inference profiles: exactly the listed ones, never inference-profile/*
      expect(JSON.stringify(models[0].Resource)).not.toContain('inference-profile/*');
      // nothing that writes, no S3 Vectors, no Step Functions, no Lambda
      const all = statements.flatMap(actionsOf);
      for (const prefix of ['s3vectors:', 'states:', 'lambda:', 'sts:', 's3:Put', 's3:Delete']) {
        expect(all.some((a) => a.startsWith(prefix))).toBe(false);
      }
      expect(all).not.toContain('neptune-graph:WriteDataViaQuery');
      expect(all).not.toContain('neptune-graph:DeleteDataViaQuery');
      expect(runtimeId).toMatch(/^QueryAgentRuntime/);
    });

    test('the API may invoke the runtime, the pipeline function too for the trends graph agent\'s job (this runtime only), and both name it in their env', () => {
      const t = sample;
      const [runtimeId] = runtimeOf(t);
      const arn = { 'Fn::GetAtt': [runtimeId, 'AgentRuntimeArn'] };
      const invoke = roleStatements(t, API).filter((s) => actionsOf(s).includes('bedrock-agentcore:InvokeAgentRuntime'));
      expect(invoke).toHaveLength(2); // this runtime and the lake agent's
      expect(invoke.map((s) => s.Resource)).toContainEqual([arn, { 'Fn::Join': ['', [arn, '/*']] }]);
      const env = fnByHandler(t, API).Properties.Environment.Variables;
      expect(env.AGENT_RUNTIME_ARN).toEqual(arn);
      expect(env.AGENT_ROLE_ARN).toBeUndefined(); // the API no longer hands out credentials
      // the pipeline function: InvokeAgentRuntime on the query agent's runtime and its endpoints, nothing else
      const agentcoreOf = (handler: string) => roleStatements(t, handler).filter((s) => actionsOf(s).some((a) => a.startsWith('bedrock-agentcore:')));
      expect(agentcoreOf(PIPELINE)).toEqual([
        { Action: 'bedrock-agentcore:InvokeAgentRuntime', Effect: 'Allow', Resource: [arn, { 'Fn::Join': ['', [arn, '/*']] }] },
      ]);
      expect(fnByHandler(t, PIPELINE).Properties.Environment.Variables.AGENT_RUNTIME_ARN).toEqual(arn);
      expect(fnByHandler(t, PIPELINE).Properties.Environment.Variables.LAKE_RUNTIME_ARN).toBeUndefined();
      expect(agentcoreOf(LOADER)).toEqual([]);
      expect(fnByHandler(t, LOADER).Properties.Environment.Variables.AGENT_RUNTIME_ARN).toBeUndefined();
      // no role assumed anywhere any more
      const all = Object.values(t.findResources('AWS::IAM::Policy')).flatMap((p: any) => p.Properties.PolicyDocument.Statement);
      expect(all.some((s: any) => actionsOf(s).includes('sts:AssumeRole'))).toBe(false);
      expect(Object.keys(t.findOutputs('AgentRuntimeArn'))).toHaveLength(1);
    });

    test("the trends graph agent's job: each limit ends inside the one around it, from the browser's poll to the agent's last tool call", () => {
      const t = sample;
      const source = (...parts: string[]) => fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8');
      const number = (text: string, name: string) => Number(text.match(new RegExp(`^ *${name} = \\(?\\s*(\\d+)`, 'm'))?.[1]);
      const py = (file: string) => source('backend', 'src', 'ontology_rag', file);
      const [queryAgent, jobs, vision] = [py('query_agent.py'), py('jobs.py'), py('vision.py')];
      const deadline = number(queryAgent, 'MAX_DEADLINE_S');
      const jobRead = number(queryAgent, 'JOB_READ_S');
      const tool = number(queryAgent, 'TOOL_TIMEOUT_S');
      const [connect, call] = [number(vision, 'CONNECT_TIMEOUT_S'), number(vision, 'API_CALL_TIMEOUT_S')];
      const [queue, run] = [number(jobs, 'QUEUE_S'), number(jobs, 'RUN_S')];
      const webJob = source('web', 'src', 'components', 'lenses', 'trendsJob.ts');
      const pollLimitS = Number(webJob.match(/POLL_LIMIT_MS = (\d+) \* 60 \* 1000/)?.[1]) * 60;
      expect([deadline, jobRead, tool, connect, call, queue, run]).toEqual([300, 345, 25, 5, 100, 300, 360]);
      // the browser waits longer than the API takes to call a lost job failed
      expect(pollLimitS).toBeGreaterThan(queue + run);
      // the pipeline function's timeout is the job's RUN_S, and holds its one call to the runtime plus 10 s of reads and writes
      expect(fnByHandler(t, PIPELINE).Properties.Timeout).toBe(PIPELINE_FUNCTION_TIMEOUT_S);
      expect(PIPELINE_FUNCTION_TIMEOUT_S).toBe(run);
      expect(connect + jobRead + 10).toBeLessThanOrEqual(PIPELINE_FUNCTION_TIMEOUT_S);
      // the call holds the agent's deadline plus 45 s for a new session's start and the way back
      expect(deadline + 45).toBeLessThanOrEqual(jobRead);
      // AgentCore ends a synchronous request after 15 minutes; the job's session works, so it is never idle
      expect(jobRead).toBeLessThan(15 * 60);
      expect(runtimeOf(t)[1].Properties.LifecycleConfiguration.IdleRuntimeSessionTimeout).toBeGreaterThan(jobRead);
      // inside the deadline: a model turn's whole budget (5 s to connect, 100 s to read) and a tool call's
      expect(queryAgent).toContain('JOB_MODEL_TURN_S = float(CONNECT_TIMEOUT_S + API_CALL_TIMEOUT_S)');
      expect(connect + call + tool).toBeLessThan(deadline);
      // tab 3 keeps its synchronous 70 s
      expect(Number(runtimeOf(t)[1].Properties.EnvironmentVariables.AGENT_DEADLINE_S)).toBe(70);
    });

    test('the Lambda zip no longer carries the MCP server; the agent zip pins its whole closure, hashed', () => {
      const names = Object.keys(requirementPins(LAMBDA_REQUIREMENTS).pins);
      for (const pkg of ['mcp', 'awslabs-amazon-neptune-mcp-server', 'pydantic-core', 'pyjwt', 'cryptography', 'cffi', 'pycparser']) {
        expect(names).not.toContain(pkg);
      }
      const { pins, hashed } = requirementPins(AGENT_REQUIREMENTS);
      expect(hashed).toBe(true); // installed with --require-hashes (agents.ts)
      expect(pins['awslabs-amazon-neptune-mcp-server']).toBe('1.1.1');
      expect(pins.mcp.startsWith('2.')).toBe(true);
      for (const pkg of ['bedrock-agentcore', 'aws-opentelemetry-distro', 'boto3', 'botocore', 'rdflib', 'starlette', 'uvicorn']) {
        expect(pins[pkg]).toBeDefined();
      }
    });
  });

  describe('the guardrail on free-form input (guardrail.ts)', () => {
    let sample: Template;
    beforeAll(() => {
      sample = synth();
    });
    const guardrailId = (t: Template) => logicalId(t, 'AWS::Bedrock::Guardrail');
    const appliesGuardrail = (statements: any[]) => statements.some((s) => actionsOf(s).includes('bedrock:ApplyGuardrail'));
    test('content filters, prompt attacks and profanity on text only, the Standard tier through the us profile', () => {
      const props = sample.findResources('AWS::Bedrock::Guardrail')[guardrailId(sample)].Properties;
      const filters = props.ContentPolicyConfig.FiltersConfig;
      expect(filters.map((f: any) => f.Type).sort()).toEqual(['HATE', 'INSULTS', 'MISCONDUCT', 'PROMPT_ATTACK', 'SEXUAL', 'VIOLENCE']);
      for (const f of filters) expect(f.InputModalities).toEqual(['TEXT']); // photos are not checked
      expect(filters.find((f: any) => f.Type === 'PROMPT_ATTACK').OutputStrength).toBe('NONE');
      expect(props.WordPolicyConfig.ManagedWordListsConfig).toEqual([{ Type: 'PROFANITY', InputEnabled: true, InputAction: 'BLOCK', OutputEnabled: false }]); // typed text only: "hobo bag" is on the list
      expect(props.ContentPolicyConfig.ContentFiltersTierConfig).toEqual({ TierName: 'STANDARD' });
      expect(JSON.stringify(props.CrossRegionConfig)).toContain('guardrail-profile/us.guardrail.v1:0');
      expect(JSON.stringify(props.Name)).toContain('AWS::StackId'); // unique per stack
      // a published version, not the draft
      sample.hasResourceProperties('AWS::Bedrock::GuardrailVersion', { GuardrailIdentifier: { 'Fn::GetAtt': [guardrailId(sample), 'GuardrailId'] } });
      // not enforced on the account: the app names it per call
      sample.resourceCountIs('AWS::Bedrock::EnforcedGuardrailConfiguration', 0);
    });
    test('a Region without a guardrail profile gets the Classic tier', () => {
      const t = synth({ env: { account: '111111111111', region: 'ca-central-1' } });
      const props = t.findResources('AWS::Bedrock::Guardrail')[guardrailId(t)].Properties;
      expect(props.ContentPolicyConfig.ContentFiltersTierConfig).toEqual({ TierName: 'CLASSIC' });
      expect(props.CrossRegionConfig).toBeUndefined();
    });
    test('the API, the pipeline and the query agent name it and may apply it; the loader and the lake agent do not', () => {
      const env = (handler: string) => fnByHandler(sample, handler).Properties.Environment.Variables;
      for (const handler of [API, PIPELINE]) {
        expect(env(handler).GUARDRAIL_ID).toEqual({ 'Fn::GetAtt': [guardrailId(sample), 'GuardrailId'] });
        expect(env(handler).GUARDRAIL_VERSION).toBeDefined();
        expect(grants(roleStatements(sample, handler), 'bedrock:ApplyGuardrail', guardrailId(sample))).toBe(true);
      }
      expect(appliesGuardrail(roleStatements(sample, LOADER))).toBe(false);
      const runtimes = sample.findResources('AWS::BedrockAgentCore::Runtime');
      const [queryId] = Object.keys(runtimes).filter((id) => id.startsWith('QueryAgentRuntime'));
      const [lakeId] = Object.keys(runtimes).filter((id) => id.startsWith('LakeAgentRuntime'));
      expect(runtimes[queryId].Properties.EnvironmentVariables.GUARDRAIL_ID).toBeDefined();
      expect(runtimes[lakeId].Properties.EnvironmentVariables.GUARDRAIL_ID).toBeUndefined();
      const statementsOf = (id: string) => {
        const roleId = runtimes[id].Properties.RoleArn['Fn::GetAtt'][0];
        return Object.values(sample.findResources('AWS::IAM::Policy'))
          .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
          .flatMap((p: any) => p.Properties.PolicyDocument.Statement);
      };
      expect(appliesGuardrail(statementsOf(queryId))).toBe(true);
      expect(appliesGuardrail(statementsOf(lakeId))).toBe(false);
    });
  });

  describe('the lakehouse and its agent (tab 6\'s trends question, method 2)', () => {
    const RUNTIME = 'AWS::BedrockAgentCore::Runtime';
    const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'backend', 'src', 'ontology_rag', 'lake_tables.json'), 'utf8'));
    let sample: Template;
    beforeAll(() => {
      sample = synth();
    });
    const lakeRuntime = (t: Template): [string, any] => {
      const ids = Object.keys(t.findResources(RUNTIME)).filter((id) => id.startsWith('LakeAgentRuntime'));
      expect(ids).toHaveLength(1);
      return [ids[0], t.findResources(RUNTIME)[ids[0]]];
    };
    const lakeStatements = (t: Template): any[] => {
      const roleId = lakeRuntime(t)[1].Properties.RoleArn['Fn::GetAtt'][0];
      return Object.values(t.findResources('AWS::IAM::Policy'))
        .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
        .flatMap((p: any) => p.Properties.PolicyDocument.Statement);
    };

    test('a table bucket of the stack with the namespace and the tables of lake_tables.json', () => {
      const t = sample;
      const bucketId = logicalId(t, 'AWS::S3Tables::TableBucket');
      const bucket = t.findResources('AWS::S3Tables::TableBucket')[bucketId];
      expect(JSON.stringify(bucket.Properties.TableBucketName)).toContain('multimodal-ai-knowledge-graph');
      expect(JSON.stringify(bucket.Properties.TableBucketName)).toContain('AWS::StackId'); // unique per stack
      expect(bucket.DeletionPolicy).toBe('Delete');
      t.hasResourceProperties('AWS::S3Tables::Namespace', { Namespace: spec.namespace });
      const tables = Object.values(t.findResources('AWS::S3Tables::Table')) as any[];
      expect(tables.map((r) => r.Properties.TableName).sort()).toEqual(Object.keys(spec.tables).sort());
      for (const table of tables) {
        expect(table.Properties.OpenTableFormat).toBe('ICEBERG');
        expect(table.DeletionPolicy).toBe('Delete'); // the bucket can only go empty
        const fields = table.Properties.IcebergMetadata.IcebergSchema.SchemaFieldList;
        expect(fields).toEqual(
          spec.tables[table.Properties.TableName].fields.map((f: any) => ({ Name: f.name, Type: f.type, Required: !!f.required })),
        );
      }
    });

    test('the lake agent: its own zip, the table bucket and the answer models, never the graph', () => {
      const t = sample;
      const [, runtime] = lakeRuntime(t);
      const env = runtime.Properties.EnvironmentVariables;
      const bucketArn = { 'Fn::GetAtt': [logicalId(t, 'AWS::S3Tables::TableBucket'), 'TableBucketARN'] };
      expect(env.TABLE_BUCKET_ARN).toEqual(bucketArn);
      expect(env.ANSWER_MODEL_IDS).toBe(fnByHandler(t, API).Properties.Environment.Variables.ANSWER_MODEL_IDS);
      expect(env.GRAPH_ID).toBeUndefined();
      expect(JSON.stringify(env).length).toBeLessThan(1536);
      const statements = lakeStatements(t);
      const all = statements.flatMap(actionsOf);
      expect(all.some((a) => a.startsWith('neptune-graph:'))).toBe(false);
      expect(all.filter((a) => a.startsWith('s3tables:')).sort()).toEqual(
        [
          's3tables:GetNamespace',
          's3tables:GetTable',
          's3tables:GetTableBucket',
          's3tables:GetTableData',
          's3tables:GetTableMetadataLocation',
          's3tables:ListNamespaces',
          's3tables:ListTables',
          's3tables:PutTableData',
          's3tables:UpdateTableMetadataLocation',
        ].sort(),
      );
      for (const s of statements.filter((x) => actionsOf(x).some((a) => a.startsWith('s3tables:')))) {
        expect(JSON.stringify(s.Resource)).toContain(logicalId(t, 'AWS::S3Tables::TableBucket'));
        expect(JSON.stringify(s.Resource)).not.toContain('"*"');
        // the bucket and its two tables by ARN, not table/*: the stack creates the tables, so it knows them
        expect(JSON.stringify(s.Resource)).not.toContain('/table/*');
        const tableIds = Object.keys(t.findResources('AWS::S3Tables::Table'));
        expect(s.Resource).toEqual([bucketArn, ...tableIds.map((id) => ({ 'Fn::GetAtt': [id, 'TableARN'] }))]);
      }
      for (const prefix of ['s3vectors:', 'states:', 'lambda:', 'sts:', 's3tables:Delete', 's3tables:Create']) {
        expect(all.some((a) => a.startsWith(prefix))).toBe(false);
      }
      // the API invokes it, names it and the bucket, and may only read when a table was written
      const runtimeArn = { 'Fn::GetAtt': [lakeRuntime(t)[0], 'AgentRuntimeArn'] };
      const apiEnv = fnByHandler(t, API).Properties.Environment.Variables;
      expect(apiEnv.LAKE_RUNTIME_ARN).toEqual(runtimeArn);
      expect(apiEnv.TABLE_BUCKET_ARN).toEqual(bucketArn);
      const apiLake = roleStatements(t, API).filter((s) => actionsOf(s).some((a) => a.startsWith('s3tables:')));
      expect(apiLake.flatMap(actionsOf)).toEqual(['s3tables:GetTable']);
      // its own zip: a CDK asset of its own, next to the query agent's
      const zip = (prefix: string) =>
        JSON.stringify(
          (Object.entries(sample.findResources(RUNTIME)).find(([id]) => id.startsWith(prefix))![1] as any).Properties.AgentRuntimeArtifact.CodeConfiguration.Code.S3,
        );
      expect(zip('LakeAgentRuntime')).toContain('cdk-hnb659fds-assets');
      expect(zip('LakeAgentRuntime')).not.toEqual(zip('QueryAgentRuntime'));
    });

    test('the lake agent zip pins its closure, hashed, with the S3 Tables MCP server on the overrides', () => {
      const { pins, hashed } = requirementPins(LAKE_AGENT_REQUIREMENTS);
      expect(hashed).toBe(true); // installed with --require-hashes (agents.ts)
      expect(pins['awslabs-s3-tables-mcp-server']).toBe('0.1.1');
      const overrides = fs
        .readFileSync(path.join(REPO_ROOT, 'backend', 'src', 'ontology_rag', 'lake_overrides.txt'), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      expect(overrides.length).toBeGreaterThan(0);
      for (const l of overrides) {
        const [name, version] = l.split('==');
        expect(pins[normalized(name.replace(/\[.*\]/, ''))]).toBe(version); // what runs deployed is what runs locally
      }
    });
  });

  describe('sign-in with Amazon Cognito (auth.ts)', () => {
    let sample: Template;
    beforeAll(() => {
      sample = synth();
    });
    const only = (t: Template, type: string): any => {
      const resources = Object.values(t.findResources(type));
      expect(resources).toHaveLength(1);
      return resources[0];
    };

    test('one user pool: admin-created users only, optional TOTP, 12-character passwords of all four classes, deleted with the stack', () => {
      const t = sample;
      const pool = only(t, 'AWS::Cognito::UserPool');
      expect(pool.Properties.AdminCreateUserConfig).toEqual({ AllowAdminCreateUserOnly: true });
      expect(pool.Properties.MfaConfiguration).toBe('OPTIONAL');
      expect(pool.Properties.EnabledMfas).toEqual(['SOFTWARE_TOKEN_MFA']); // no SMS: no SNS role, no spend
      expect(pool.Properties.Policies.PasswordPolicy).toEqual({
        MinimumLength: 12,
        RequireLowercase: true,
        RequireUppercase: true,
        RequireNumbers: true,
        RequireSymbols: true,
        TemporaryPasswordValidityDays: 3,
      });
      expect(pool.Properties.AliasAttributes).toEqual(['email']);
      expect(pool.Properties.AutoVerifiedAttributes).toEqual(['email']);
      expect(pool.Properties.AccountRecoverySetting.RecoveryMechanisms).toEqual([{ Name: 'verified_email', Priority: 1 }]);
      expect(pool.Properties.UserPoolTier).toBe('ESSENTIALS'); // threat protection needs Plus (about $0.02 per active user per month): COG8
      expect(pool.Properties.DeletionProtection).toBe('INACTIVE');
      expect(pool.DeletionPolicy).toBe('Delete');
      expect(JSON.stringify(t.findResources('AWS::IAM::Role'))).not.toContain('sns:Publish'); // no SMS role
    });

    test('a public app client: authorization code grant only, SRP and refresh, callback at the distribution', () => {
      const t = sample;
      const client = only(t, 'AWS::Cognito::UserPoolClient').Properties;
      expect(client.GenerateSecret).toBe(false);
      expect(client.AllowedOAuthFlows).toEqual(['code']);
      expect(client.AllowedOAuthFlowsUserPoolClient).toBe(true);
      expect(client.AllowedOAuthScopes.sort()).toEqual(['email', 'openid', 'profile']);
      expect(client.ExplicitAuthFlows.sort()).toEqual(['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_SRP_AUTH']); // no password auth
      const distributionId = logicalId(t, 'AWS::CloudFront::Distribution');
      const site = { 'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [distributionId, 'DomainName'] }, '/']] };
      expect(client.CallbackURLs).toEqual([site]);
      expect(client.LogoutURLs).toEqual([site]);
      expect(client.PreventUserExistenceErrors).toBe('ENABLED');
      expect(client.EnableTokenRevocation).toBe(true);
      expect(client.SupportedIdentityProviders).toEqual(['COGNITO']);
      expect([client.AccessTokenValidity, client.IdTokenValidity, client.RefreshTokenValidity]).toEqual([60, 60, 480]); // minutes
      expect(client.TokenValidityUnits).toEqual({ AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'minutes' });
    });

    test('managed login (v2) on a prefix domain unique to the stack, with the default branding', () => {
      const t = sample;
      const domain = only(t, 'AWS::Cognito::UserPoolDomain').Properties;
      expect(domain.ManagedLoginVersion).toBe(2);
      expect(JSON.stringify(domain.Domain)).toContain('multimodal-ai-knowledge-graph');
      expect(JSON.stringify(domain.Domain)).toContain('AWS::StackId');
      expect(domain.CustomDomainConfig).toBeUndefined();
      const branding = only(t, 'AWS::Cognito::ManagedLoginBranding');
      expect(branding.Properties.UseCognitoProvidedValues).toBe(true);
      expect(branding.Properties.ClientId).toEqual({ Ref: logicalId(t, 'AWS::Cognito::UserPoolClient') });
      expect(branding.Properties.UserPoolId).toEqual({ Ref: logicalId(t, 'AWS::Cognito::UserPool') });
      expect(branding.DependsOn).toEqual([logicalId(t, 'AWS::Cognito::UserPoolDomain')]);
    });

    test('an identity pool for the signed-in user only: no guest identities, no classic flow, the web client, revoked tokens refused', () => {
      const t = sample;
      const pool = only(t, 'AWS::Cognito::IdentityPool').Properties;
      expect(pool.AllowUnauthenticatedIdentities).toBe(false); // cdk-nag COG7, Security Hub Cognito.2
      expect(pool.AllowClassicFlow).toBe(false);
      expect(pool.CognitoIdentityProviders).toEqual([
        {
          ClientId: { Ref: logicalId(t, 'AWS::Cognito::UserPoolClient') },
          ProviderName: { 'Fn::GetAtt': [logicalId(t, 'AWS::Cognito::UserPool'), 'ProviderName'] },
          ServerSideTokenCheck: true,
        },
      ]);
      const roles = only(t, 'AWS::Cognito::IdentityPoolRoleAttachment').Properties;
      expect(roles.IdentityPoolId).toEqual({ Ref: logicalId(t, 'AWS::Cognito::IdentityPool') });
      expect(Object.keys(roles.Roles)).toEqual(['authenticated']); // no unauthenticated role
      expect(roles.RoleMappings).toBeUndefined();
    });

    test('the signed-in role: only Cognito for this identity pool and signed-in identities assume it, and it may only call the API function URL', () => {
      const t = sample;
      const roleId = Object.keys(t.findResources('AWS::IAM::Role')).find((id) => id.startsWith('AuthSignedInRole'))!;
      const role = t.findResources('AWS::IAM::Role')[roleId].Properties;
      expect(role.AssumeRolePolicyDocument.Statement).toEqual([
        {
          Effect: 'Allow',
          Principal: { Federated: 'cognito-identity.amazonaws.com' },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: { 'cognito-identity.amazonaws.com:aud': { Ref: logicalId(t, 'AWS::Cognito::IdentityPool') } },
            'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
          },
        },
      ]);
      expect(role.ManagedPolicyArns).toBeUndefined();
      expect(role.Policies).toBeUndefined();
      const api = { 'Fn::GetAtt': [logicalIdOfFn(t, API), 'Arn'] };
      const statements = Object.values(t.findResources('AWS::IAM::Policy'))
        .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
        .flatMap((p: any) => p.Properties.PolicyDocument.Statement);
      expect(statements).toEqual([
        { Sid: 'CallTheApiFunctionUrl', Effect: 'Allow', Action: 'lambda:InvokeFunctionUrl', Resource: api, Condition: { StringEquals: { 'lambda:FunctionUrlAuthType': 'AWS_IAM' } } },
        { Sid: 'InvokeTheApiThroughItsUrl', Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: api, Condition: { Bool: { 'lambda:InvokedViaFunctionUrl': 'true' } } },
      ]);
    });

    test('the API holds no sign-in setting: no Cognito variables, no client id parameter, no SSM read', () => {
      const t = sample;
      t.resourceCountIs('AWS::SSM::Parameter', 0);
      for (const handler of [API, PIPELINE, LOADER]) {
        const env = fnByHandler(t, handler).Properties.Environment.Variables;
        for (const name of ['AUTH_REQUIRED', 'COGNITO_USER_POOL_ID', 'COGNITO_DOMAIN', 'AUTH_CLIENT_ID_PARAMETER', 'COGNITO_CLIENT_ID']) {
          expect(env[name]).toBeUndefined();
        }
        expect(roleStatements(t, handler).some((s) => actionsOf(s).some((a) => a.startsWith('ssm:')))).toBe(false);
      }
    });

    test('the browser reads /config.json from the site bucket, written at deploy: pool, client, domain, identity pool, API URL', () => {
      const t = sample;
      const deploy = Object.entries(t.findResources('Custom::CDKBucketDeployment')).find(([id]) => id.startsWith('SiteDeploy'));
      // no web/dist in a fresh checkout's test run: the site deployment (and its config) needs the built site
      if (!deploy) return;
      const markers = JSON.stringify(deploy[1].Properties.SourceMarkers);
      for (const ref of ['AWS::Cognito::UserPool', 'AWS::Cognito::UserPoolClient', 'AWS::Cognito::UserPoolDomain', 'AWS::Cognito::IdentityPool']) {
        expect(markers).toContain(logicalId(t, ref));
      }
      expect(markers).toContain('FunctionUrl');
    });

    test('the one user is created silently and gets its generated password through Custom::AuthSetup', () => {
      const t = sample;
      const user = only(t, 'AWS::Cognito::UserPoolUser');
      expect(user.Properties.MessageAction).toBe('SUPPRESS'); // no invitation email, no temporary password
      expect(user.Properties.Username).toEqual({ Ref: 'SignInUser' });
      expect(user.Properties.UserAttributes).toEqual([
        { Name: 'email', Value: { Ref: 'SignInEmail' } },
        { Name: 'email_verified', Value: 'true' },
      ]);
      const json = t.toJSON();
      expect(json.Parameters.SignInUser).toEqual(expect.objectContaining({ Type: 'String', Default: 'participant' }));
      expect(json.Parameters.SignInEmail).toEqual(expect.objectContaining({ Type: 'String', Default: 'participant@example.com' }));

      const secretId = logicalId(t, 'AWS::SecretsManager::Secret');
      const secret = t.findResources('AWS::SecretsManager::Secret')[secretId];
      expect(secret.Properties.GenerateSecretString).toEqual(
        expect.objectContaining({ PasswordLength: 24, RequireEachIncludedType: true }),
      );
      expect(secret.Properties.SecretString).toBeUndefined();
      expect(JSON.stringify(secret.Properties.Name)).toContain('multimodal-ai-knowledge-graph');
      expect(JSON.stringify(secret.Properties.Name)).toContain('sign-in');
      expect(secret.DeletionPolicy).toBe('Delete');

      t.resourceCountIs('Custom::AuthSetup', 1);
      const setup = Object.values(t.findResources('Custom::AuthSetup'))[0] as any;
      expect(setup.DependsOn.sort()).toEqual([secretId, logicalId(t, 'AWS::Cognito::UserPoolUser')].sort());
      expect(setup.Properties.UserPoolId).toEqual({ Ref: logicalId(t, 'AWS::Cognito::UserPool') });
      expect(setup.Properties.Username).toEqual({ Ref: 'SignInUser' });
      expect(setup.Properties.SecretArn).toEqual({ Ref: secretId });
      expect(setup.Properties.Version).toBeDefined();
      const [setupFnId, setupFn] = Object.entries(t.findResources('AWS::Lambda::Function', { Properties: { Handler: AUTH_SETUP } }))[0] as [string, any];
      expect(setup.Properties.ServiceToken).toEqual({ 'Fn::GetAtt': [setupFnId, 'Arn'] });
      expect(setupFn.Properties.Timeout).toBe(120);
      expect(setupFn.Properties.Code).toEqual(fnByHandler(t, API).Properties.Code); // the same zip as the other functions
      // exactly what the handler does: read the secret, set the password, and write its own log group
      const statements = roleStatements(t, AUTH_SETUP);
      expect(statements).toHaveLength(3);
      expect(statements.flatMap(actionsOf).sort()).toEqual([
        'cognito-idp:AdminSetUserPassword',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'secretsmanager:GetSecretValue',
      ]);
      expect(statements.find((s) => actionsOf(s).includes('cognito-idp:AdminSetUserPassword')).Resource).toEqual({
        'Fn::GetAtt': [logicalId(t, 'AWS::Cognito::UserPool'), 'Arn'],
      });
      expect(statements.find((s) => actionsOf(s).includes('secretsmanager:GetSecretValue')).Resource).toEqual({ Ref: secretId });
      // nobody else touches the pool's users or the secret
      for (const handler of [API, PIPELINE, LOADER]) {
        const actions = roleStatements(t, handler).flatMap(actionsOf);
        expect(actions.some((a) => a.startsWith('cognito-idp:') || a.startsWith('secretsmanager:'))).toBe(false);
      }
    });

    test('outputs name the pool, the user, the secret and the site; the password is never an output', () => {
      const t = sample;
      const outputs = t.toJSON().Outputs;
      expect(outputs.UserPoolId.Value).toEqual({ Ref: logicalId(t, 'AWS::Cognito::UserPool') });
      expect(outputs.IdentityPoolId.Value).toEqual({ Ref: logicalId(t, 'AWS::Cognito::IdentityPool') });
      expect(outputs.ApiUrl.Value).toEqual({ 'Fn::GetAtt': [Object.keys(t.findResources('AWS::Lambda::Url'))[0], 'FunctionUrl'] });
      expect(outputs.SignInUser.Value).toEqual({ Ref: 'SignInUser' });
      expect(outputs.SignInPasswordSecret.Value).toEqual(only(t, 'AWS::SecretsManager::Secret').Properties.Name);
      expect(outputs.SignInUrl.Value).toEqual(outputs.SiteUrl.Value);
      const all = JSON.stringify(outputs);
      expect(all).not.toContain('resolve:secretsmanager');
      expect(all).not.toContain('SecretString');
    });

    test('the AuthSetup function runs the stack\'s own asset, shared with the API (one upload, one hash)', () => {
      const code = fnByHandler(sample, AUTH_SETUP).Properties.Code;
      expect(JSON.stringify(code)).toContain('cdk-hnb659fds-assets');
      expect(code).toEqual(fnByHandler(sample, API).Properties.Code);
    });

    test('the Lambda bundle carries no token library: IAM decides who may call the API', () => {
      const { pins } = requirementPins(LAMBDA_REQUIREMENTS);
      for (const dep of ['pyjwt', 'cryptography', 'cffi', 'pycparser']) expect(pins[dep]).toBeUndefined();
    });
  });

  describe('hardening (cdk-nag findings fixed rather than acknowledged)', () => {
    let sample: Template;
    beforeAll(() => {
      sample = synth();
    });
    const distributionOf = (t: Template): any => Object.values(t.findResources('AWS::CloudFront::Distribution'))[0];
    const only = (t: Template, type: string): any => {
      const resources = Object.values(t.findResources(type));
      expect(resources).toHaveLength(1);
      return resources[0];
    };

    test('one response headers policy on the site: CSP with the Cognito hosts and the Region\'s function URLs, HSTS for two years, no framing, no sniffing', () => {
      const t = sample;
      const policyId = logicalId(t, 'AWS::CloudFront::ResponseHeadersPolicy');
      const config = distributionOf(t).Properties.DistributionConfig;
      expect(config.DefaultCacheBehavior.ResponseHeadersPolicyId).toEqual({ Ref: policyId });
      expect(config.CacheBehaviors).toBeUndefined(); // the site only: the browser calls the API's function URL itself
      const headers = only(t, 'AWS::CloudFront::ResponseHeadersPolicy').Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
      expect(headers.StrictTransportSecurity).toEqual({ AccessControlMaxAgeSec: 730 * 24 * 3600, IncludeSubdomains: true, Override: true });
      expect(headers.ContentTypeOptions).toEqual({ Override: true });
      expect(headers.FrameOptions).toEqual({ FrameOption: 'DENY', Override: true });
      expect(headers.ReferrerPolicy).toEqual({ ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true });
      expect(headers.ContentSecurityPolicy.Override).toBe(true);
      // the CSP is a Fn::Join around the managed-login domain; flatten it to read the directives
      const csp = headers.ContentSecurityPolicy.ContentSecurityPolicy['Fn::Join'][1]
        .map((part: any) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join('');
      const directives = Object.fromEntries(csp.split('; ').map((d: string) => [d.split(' ')[0], d.slice(d.indexOf(' ') + 1)]));
      expect(directives['default-src']).toBe("'self'");
      expect(directives['script-src']).toBe("'self'"); // no inline scripts: Vite emits none (web/dist/index.html)
      expect(directives['style-src']).toBe("'self' 'unsafe-inline'"); // the <style> elements the graph library (force-graph) injects
      expect(directives['img-src']).toBe("'self' data: blob:");
      expect(directives['font-src']).toBe("'self' data:");
      expect(directives['frame-ancestors']).toBe("'none'");
      expect(directives['base-uri']).toBe("'self'");
      expect(directives['object-src']).toBe("'none'");
      // the OpenID configuration and JWKS come from the pool's issuer host, the token endpoint and the sign-out form from managed login,
      // the credentials from the identity pool, the answers from the API's function URL (by the Region's pattern: see addWebSite)
      const domainId = logicalId(t, 'AWS::Cognito::UserPoolDomain');
      expect(directives['connect-src']).toMatch(
        /^'self' https:\/\/cognito-idp\.us-east-1\.amazonaws\.com https:\/\/.+\.auth\..+\.amazoncognito\.com https:\/\/cognito-identity\.us-east-1\.amazonaws\.com https:\/\/\*\.lambda-url\.us-east-1\.on\.aws$/,
      );
      expect(directives['connect-src']).toContain(domainId);
      expect(directives['form-action']).toMatch(/^'self' https:\/\/.+\.auth\..+\.amazoncognito\.com$/);
      expect(directives['form-action']).toContain(domainId);
      expect(csp).not.toContain('unsafe-eval');
      expect(csp).not.toContain('http://');
      expect(JSON.stringify(only(sample, 'AWS::CloudFront::ResponseHeadersPolicy'))).toContain('https://cognito-idp.us-east-1.amazonaws.com');
    });

    test('framing stays off unless origins are named: then CSP frame-ancestors lists them and X-Frame-Options is left out', () => {
      const t = synth({ frameAncestors: ['http://localhost:3030', 'https://slides.example.com'] });
      const config = only(t, 'AWS::CloudFront::ResponseHeadersPolicy').Properties.ResponseHeadersPolicyConfig;
      expect(config.SecurityHeadersConfig.FrameOptions).toBeUndefined();
      const csp = config.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy['Fn::Join'][1]
        .map((part: any) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join('');
      expect(csp).toContain("frame-ancestors 'self' http://localhost:3030 https://slides.example.com;");
      // the default (no origins) is checked by the test above: DENY and frame-ancestors 'none'
    });

    test('the same policy turns off camera, microphone and location (Permissions-Policy), framed or not', () => {
      const expected = { Items: [{ Header: 'Permissions-Policy', Value: 'camera=(), microphone=(), geolocation=()', Override: true }] };
      for (const t of [sample, synth({ frameAncestors: ['http://localhost:3030'] })]) {
        const config = only(t, 'AWS::CloudFront::ResponseHeadersPolicy').Properties.ResponseHeadersPolicyConfig;
        expect(config.CustomHeadersConfig).toEqual(expected);
      }
      // the web app asks the browser for none of them, so the header takes nothing away
      const webSrc = path.join(REPO_ROOT, 'web', 'src');
      const sources = (fs.readdirSync(webSrc, { recursive: true }) as string[])
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => fs.readFileSync(path.join(webSrc, f), 'utf8'))
        .join('\n');
      expect(sources).not.toMatch(/getUserMedia|mediaDevices|geolocation/);
    });

    test.each(['*', 'https://*.example.com', "'self'", 'http://slides.example.com', 'https://example.com/deck', 'localhost:3030', 'https://slides.example.com:70000', 'http://localhost:0'])(
      'frameAncestors refuses %s at synth',
      (origin) => {
        expect(() => checkFrameAncestors([origin])).toThrow(/is not an origin this stack accepts/);
      },
    );

    test('the site behavior needs nothing from the viewer: no origin request policy, HTTP/2 and 3', () => {
      const config = distributionOf(sample).Properties.DistributionConfig;
      expect(config.DefaultCacheBehavior.OriginRequestPolicyId).toBeUndefined();
      expect(config.HttpVersion).toBe('http2and3');
    });

    test('one access-log bucket: CloudFront standard logs and the server access logs of the site and data buckets, 30 days, deleted with the stack', () => {
      const t = sample;
      const logsId = bucketId(t, 'LogsBucket');
      const logsBucket = t.findResources('AWS::S3::Bucket')[logsId];
      expect(logsBucket.Properties.AccessControl).toBe('LogDeliveryWrite'); // CloudFront standard logging writes with the bucket ACL
      expect(logsBucket.Properties.OwnershipControls).toEqual({ Rules: [{ ObjectOwnership: 'ObjectWriter' }] });
      expect(logsBucket.Properties.LifecycleConfiguration.Rules).toEqual([{ ExpirationInDays: 30, Status: 'Enabled' }]);
      expect(logsBucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault).toEqual({ SSEAlgorithm: 'AES256' });
      expect(logsBucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(logsBucket.Properties.LoggingConfiguration).toBeUndefined(); // it does not log into itself
      expect(logsBucket.DeletionPolicy).toBe('Delete');
      // TLS only, like the other buckets
      const policy = Object.values(t.findResources('AWS::S3::BucketPolicy')).find((p: any) => p.Properties.Bucket.Ref === logsId) as any;
      expect(JSON.stringify(policy.Properties.PolicyDocument)).toContain('"aws:SecureTransport":"false"');
      // the distribution logs into it under cloudfront/
      expect(distributionOf(t).Properties.DistributionConfig.Logging).toEqual({
        Bucket: { 'Fn::GetAtt': [logsId, 'RegionalDomainName'] },
        Prefix: 'cloudfront/',
      });
      // the site and the data bucket log into it under their own prefixes
      expect(t.findResources('AWS::S3::Bucket')[bucketId(t, 'SiteBucket')].Properties.LoggingConfiguration).toEqual({
        DestinationBucketName: { Ref: logsId },
        LogFilePrefix: 'site/',
      });
      expect(t.findResources('AWS::S3::Bucket')[dataBucketId(t)].Properties.LoggingConfiguration).toEqual({
        DestinationBucketName: { Ref: logsId },
        LogFilePrefix: 'data/',
      });
      // emptied before deletion by aws-cdk-lib's auto-delete custom resource, and only once the
      // buckets and the distribution that write into it are gone: S3 delivers access logs minutes
      // late, so an early emptying leaves the logs of the other buckets' own emptying behind and
      // `cdk destroy` fails on a bucket that is not empty. CloudFormation deletes a resource before
      // what it depends on, so the writers depend on the emptying.
      const autoDeleteId = Object.entries(t.findResources('Custom::S3AutoDeleteObjects')).find(([, r]: [string, any]) => r.Properties.BucketName.Ref === logsId)?.[0];
      expect(autoDeleteId).toBeDefined();
      const all = t.toJSON().Resources;
      for (const writer of [dataBucketId(t), bucketId(t, 'SiteBucket'), logicalId(t, 'AWS::CloudFront::Distribution')]) {
        expect(all[writer].DependsOn).toEqual(expect.arrayContaining([autoDeleteId]));
      }
      // the emptying denies new objects through the bucket policy; the policy is kept so the deny
      // holds until the bucket's own delete (S3 removes a bucket's policy with the bucket)
      const logsPolicyId = Object.entries(t.findResources('AWS::S3::BucketPolicy')).find(([, p]: [string, any]) => p.Properties.Bucket.Ref === logsId)![0];
      expect(all[logsPolicyId].DeletionPolicy).toBe('Retain');
      for (const other of Object.entries(t.findResources('AWS::S3::BucketPolicy')).filter(([id]) => id !== logsPolicyId)) {
        expect((other[1] as any).DeletionPolicy).toBeUndefined(); // only the logs bucket's is kept
      }
      // no function of the sample reads or writes the logs
      for (const handler of [API, PIPELINE, LOADER, AUTH_SETUP]) {
        expect(JSON.stringify(roleStatements(t, handler))).not.toContain(logsId);
      }
    });

    test('the ingest pipeline logs every event (without the execution data) to its own 30-day log group and traces with X-Ray', () => {
      const t = sample;
      const sm = only(t, 'AWS::StepFunctions::StateMachine').Properties;
      const logGroupId = Object.keys(t.findResources('AWS::Logs::LogGroup')).find((id) => id.startsWith('IngestPipelineLogs'))!;
      expect(sm.LoggingConfiguration).toEqual({
        Destinations: [{ CloudWatchLogsLogGroup: { LogGroupArn: { 'Fn::GetAtt': [logGroupId, 'Arn'] } } }],
        IncludeExecutionData: false,
        Level: 'ALL',
      });
      expect(sm.TracingConfiguration).toEqual({ Enabled: true });
      const logGroup = t.findResources('AWS::Logs::LogGroup')[logGroupId];
      expect(logGroup.Properties.RetentionInDays).toBe(30);
      expect(logGroup.DeletionPolicy).toBe('Delete');
    });

    test('the AgentCore runtimes log to the service-owned groups: the stack declares none (a stack-owned group collides with the one the service creates)', () => {
      const t = sample;
      expect(Object.keys(t.findResources('AWS::BedrockAgentCore::Runtime'))).toHaveLength(2);
      const runtimeLogGroups = Object.values(t.findResources('AWS::Logs::LogGroup')).filter((g: any) =>
        JSON.stringify(g.Properties.LogGroupName ?? '').includes('/aws/bedrock-agentcore/runtimes/'),
      );
      expect(runtimeLogGroups).toHaveLength(0);
      // the roles may still create and write the service's group
      const statements = JSON.stringify(t.findResources('AWS::IAM::Policy'));
      expect(statements).toContain('/aws/bedrock-agentcore/runtimes/');
    });
    test('the Lambda roles name their models: no inference-profile/*, and the API has no states:* on "*"', () => {
      const t = sample;
      const models = DEFAULT_VISION_MODEL_IDS;
      for (const handler of [API, PIPELINE, LOADER]) {
        const bedrock = roleStatements(t, handler).filter((s) => actionsOf(s).includes('bedrock:InvokeModel'));
        expect(bedrock).toHaveLength(1);
        const resources = JSON.stringify(bedrock[0].Resource);
        expect(resources).not.toContain('inference-profile/*');
        for (const id of models) expect(resources).toContain(`inference-profile/${id}`);
        expect(resources).toContain('foundation-model/*'); // the models the profiles route to
        expect(resources).not.toContain('arn:aws:'); // partition from the pseudo parameter / the stack's partition
      }
      const states = roleStatements(t, API).filter((s) => actionsOf(s).some((a) => a.startsWith('states:')));
      expect(states.flatMap(actionsOf).sort()).toEqual(['states:DescribeExecution', 'states:StartExecution']);
      for (const s of states) {
        expect(s.Resource).not.toBe('*');
        expect(JSON.stringify(s.Resource)).toContain(logicalId(t, 'AWS::StepFunctions::StateMachine'));
      }
      expect(JSON.stringify(states.find((s) => actionsOf(s).includes('states:DescribeExecution')).Resource)).toContain(':execution:');
      // the pipeline and the loader never touch Step Functions
      for (const handler of [PIPELINE, LOADER]) {
        expect(roleStatements(t, handler).some((s) => actionsOf(s).some((a) => a.startsWith('states:')))).toBe(false);
      }
      // GetTable on the two tables of the lake, not on table/*
      const tables = roleStatements(t, API).filter((s) => actionsOf(s).includes('s3tables:GetTable'));
      expect(tables).toHaveLength(1);
      expect(JSON.stringify(tables[0].Resource)).not.toContain('/table/*');
      expect(tables[0].Resource).toHaveLength(2);
    });

    test('no "arn:aws:" literal in the template', () => {
      // The test app leaves `@aws-cdk/core:enablePartitionLiterals` off, so a partition hard-coded in
      // infra/ or in pipeline.asl.json would show here as a literal; with the flag (cdk.json) a real
      // sample synth renders the pseudo parameter as `aws` for the Region the stack is bound to,
      // which is the intended result.
      const t = sample;
      const text = JSON.stringify(t.toJSON());
      expect(text.match(/arn:aws:[^"\\]{0,30}/g) ?? []).toEqual([]);
      // the state machine definition takes the partition from the stack like every other ARN
      const sm = only(t, 'AWS::StepFunctions::StateMachine');
      expect(sm.Properties.DefinitionString).toContain('arn:${Partition}:states:::lambda:invoke');
      expect(sm.Properties.DefinitionSubstitutions.Partition).toEqual({ Ref: 'AWS::Partition' });
    });

    test('every taggable resource carries project=multimodal-ai-knowledge-graph (set once on the app)', () => {
      const t = sample;
      const tag = { Key: 'project', Value: 'multimodal-ai-knowledge-graph' };
      expect(fnByHandler(t, API).Properties.Tags).toContainEqual(tag);
      expect(t.findResources('AWS::S3::Bucket')[dataBucketId(t)].Properties.Tags).toContainEqual(tag);
      expect(only(t, 'AWS::NeptuneGraph::Graph').Properties.Tags).toContainEqual(tag);
      expect(only(t, 'AWS::CloudFront::Distribution').Properties.Tags).toContainEqual(tag);
      expect(only(t, 'AWS::StepFunctions::StateMachine').Properties.Tags).toContainEqual(tag);
      for (const runtime of Object.values(t.findResources('AWS::BedrockAgentCore::Runtime')) as any[]) {
        expect(runtime.Properties.Tags).toEqual({ project: 'multimodal-ai-knowledge-graph' });
      }
      // the stack itself sets no tag: a stack synthesized without the app-level tag has none
      const bare = new cdk.App({ context: NO_BUNDLING });
      const untagged = Template.fromStack(new MultimodalAiKnowledgeGraphStack(bare, 'Bare', { env: { account: '111111111111', region: 'us-east-1' } }));
      expect(JSON.stringify(untagged.toJSON())).not.toContain('"project"');
    });

    test('the functions run on the latest Python runtime, the one the vendored wheels are built for', () => {
      expect(LAMBDA_RUNTIME.name).toBe('python3.14');
      const t = sample;
      for (const fn of Object.values(t.findResources('AWS::Lambda::Function')) as any[]) {
        if (fn.Properties.Handler.startsWith('ontology_rag.')) expect(fn.Properties.Runtime).toBe('python3.14');
      }
    });

    test('each function writes to its own log group with a role of its own: no AWSLambdaBasicExecutionRole, no logs:* on every log group', () => {
      const t = sample;
      const functions = Object.entries(t.findResources('AWS::Lambda::Function')).filter(([, fn]: [string, any]) =>
        fn.Properties.Handler.startsWith('ontology_rag.'),
      );
      expect(functions.length).toBe(4); // API, pipeline, loader, auth setup
      for (const [, fn] of functions as [string, any][]) {
        const logGroupId = fn.Properties.LoggingConfig.LogGroup.Ref;
        expect(t.findResources('AWS::Logs::LogGroup')[logGroupId]).toBeDefined();
        const role = t.findResources('AWS::IAM::Role')[fn.Properties.Role['Fn::GetAtt'][0]];
        expect(role.Properties.ManagedPolicyArns).toBeUndefined();
        const statements = roleStatements(t, fn.Properties.Handler);
        const logging = statements.filter((s) => actionsOf(s).some((a) => a.startsWith('logs:Create') || a === 'logs:PutLogEvents'));
        expect(logging).toHaveLength(1);
        expect(actionsOf(logging[0]).sort()).toEqual(['logs:CreateLogStream', 'logs:PutLogEvents']);
        expect(logging[0].Resource).toEqual({ 'Fn::GetAtt': [logGroupId, 'Arn'] });
        expect(statements.flatMap(actionsOf)).not.toContain('logs:CreateLogGroup');
      }
      // the three functions in the VPC: what Lambda needs for their network interfaces, on '*', and
      // the same actions denied to calls from the function's own code (lambda:SourceFunctionArn is
      // present only on those). Matched by action and condition: aws-iam:minimizePolicies (cdk.json)
      // may merge statements.
      const interfaceActions = [
        'ec2:AssignPrivateIpAddresses',
        'ec2:CreateNetworkInterface',
        'ec2:DeleteNetworkInterface',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DescribeSubnets',
        'ec2:UnassignPrivateIpAddresses',
      ];
      for (const handler of [API, PIPELINE, LOADER]) {
        const statements = roleStatements(t, handler);
        const allowed = statements.filter((s) => s.Effect === 'Allow' && s.Resource === '*' && !s.Condition).flatMap(actionsOf);
        for (const action of interfaceActions) expect(allowed).toContain(action);
        const denies = statements.filter((s) => s.Effect === 'Deny');
        expect(denies).toHaveLength(1);
        expect(actionsOf(denies[0]).sort()).toEqual([...interfaceActions, 'ec2:DetachNetworkInterface'].sort());
        expect(denies[0].Resource).toBe('*');
        expect(denies[0].Condition).toEqual({ Null: { 'lambda:SourceFunctionArn': 'false' } });
        // no other EC2 action (the roles keep no managed policy: checked above)
        const ec2Actions = new Set(statements.flatMap(actionsOf).filter((a) => a.startsWith('ec2:')));
        expect([...ec2Actions].sort()).toEqual([...interfaceActions, 'ec2:DetachNetworkInterface'].sort());
      }
      expect(roleStatements(t, AUTH_SETUP).flatMap(actionsOf).some((a) => a.startsWith('ec2:'))).toBe(false);
      // the roles left with the managed policy belong to aws-cdk-lib's providers: the
      // BucketDeployment function, the S3 auto-delete function and the VPC's default-security-group
      // function (whose L1 roles cdk-nag cannot see)
      const managed = Object.entries(t.findResources('AWS::IAM::Role')).filter(([, r]: [string, any]) =>
        JSON.stringify(r.Properties.ManagedPolicyArns ?? []).includes('AWSLambdaBasicExecutionRole'),
      );
      expect(managed.map(([id]) => id.replace(/[0-9A-F]{8}$/, '')).sort()).toEqual([
        'CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756CServiceRole',
        'CustomS3AutoDeleteObjectsCustomResourceProviderRole',
        'CustomVpcRestrictDefaultSGCustomResourceProviderRole',
      ]);
    });

    test("aws-cdk-lib's BucketDeployment provider logs to a group the stack owns: 30 days, deleted with the stack, one for both deployments", () => {
      const t = sample;
      const providers = Object.entries(t.findResources('AWS::Lambda::Function')).filter(([id]) => id.startsWith('CustomCDKBucketDeployment'));
      expect(providers).toHaveLength(1); // a singleton: the ontologies and the site deployment share it
      const [providerId, provider] = providers[0] as [string, any];
      const logGroupId = provider.Properties.LoggingConfig.LogGroup.Ref;
      expect(logGroupId).toMatch(/^DeployLogs/);
      const logGroup = t.findResources('AWS::Logs::LogGroup')[logGroupId];
      expect(logGroup.Properties.RetentionInDays).toBe(30);
      expect(logGroup.DeletionPolicy).toBe('Delete');
      // on `cdk destroy` the group goes after the function's role: the function runs during the
      // delete, its last log lines arrive seconds later, and its role may create log groups
      const roleId = provider.Properties.Role['Fn::GetAtt'][0];
      expect(t.findResources('AWS::IAM::Role')[roleId].DependsOn).toEqual(expect.arrayContaining([logGroupId]));
      // every deployment runs on that function (the site one exists when web/dist was built)
      const deployments = Object.values(t.findResources('Custom::CDKBucketDeployment')) as any[];
      expect(deployments.length).toBeGreaterThanOrEqual(1);
      for (const deployment of deployments) {
        expect(deployment.Properties.ServiceToken).toEqual({ 'Fn::GetAtt': [providerId, 'Arn'] });
      }
    });

    test('the loader re-runs when the ontology, one of its data sets or the loading code changes (.ttl and .json of ontologies/<domain>, and eight modules)', () => {
      const repoRoot = path.resolve(__dirname, '..', '..');
      const version = (root: string) => Object.values(synth({ repoRoot: root }).findResources('Custom::GraphLoader'))[0].Properties.Version;
      // the hash of the domain folder, then the hash of the code that loads it
      expect(version(repoRoot)).toMatch(new RegExp(`^${contentHash(path.join(repoRoot, 'ontologies', 'fashion'))}-[0-9a-f]{16}$`));
      const stage = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ontology-hash-'));
      try {
        for (const dir of ['ontologies/fashion', 'backend/src/ontology_rag', 'backend/agentcore', 'backend/agentcore-lake']) {
          fs.cpSync(path.join(repoRoot, dir), path.join(stage, dir), { recursive: true });
        }
        const before = version(stage);
        expect(before).toBe(version(repoRoot)); // same inputs, same hash
        fs.appendFileSync(path.join(stage, 'ontologies', 'fashion', 'fashion.ttl'), '\n# a change to the ontology\n');
        const afterTtl = version(stage);
        expect(afterTtl).not.toBe(before);
        fs.appendFileSync(path.join(stage, 'ontologies', 'fashion', 'examples', 'images', 'manifest.json'), '\n');
        const afterNestedJson = version(stage);
        expect(afterNestedJson).not.toBe(afterTtl);
        fs.writeFileSync(path.join(stage, 'ontologies', 'fashion', 'README.md'), 'docs do not count\n');
        expect(version(stage)).toBe(afterNestedJson);
        // a new data set re-runs the load
        const set = path.join(stage, 'ontologies', 'fashion', 'datasets', 'extra');
        fs.mkdirSync(set, { recursive: true });
        fs.writeFileSync(path.join(set, 'graph.json'), '{"nodes": [], "edges": []}\n');
        const afterSet = version(stage);
        expect(afterSet).not.toBe(afterNestedJson);
        // a change to the code that writes the graph or the catalog re-runs it too; others do not
        fs.appendFileSync(path.join(stage, 'backend', 'src', 'ontology_rag', 'payoff.py'), '\n# a change\n');
        const afterCode = version(stage);
        expect(afterCode).not.toBe(afterSet);
        fs.appendFileSync(path.join(stage, 'backend', 'src', 'ontology_rag', 'api.py'), '\n# a change\n');
        expect(version(stage)).toBe(afterCode);
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
    });

    test('defaultDomain picks the ontology the graph is built from: ONTOLOGY_PATH and the loader hash follow it', () => {
      const fashion = synth();
      const other = synth({ defaultDomain: 'x' });
      for (const handler of [API, PIPELINE, LOADER]) {
        expect(fnByHandler(fashion, handler).Properties.Environment.Variables.ONTOLOGY_PATH).toBe('/var/task/ontologies/fashion/fashion.ttl');
        expect(fnByHandler(other, handler).Properties.Environment.Variables.ONTOLOGY_PATH).toBe('/var/task/ontologies/x/x.ttl');
      }
      const version = (t: Template) => Object.values(t.findResources('Custom::GraphLoader'))[0].Properties.Version;
      expect(version(other)).not.toBe(version(fashion)); // ontologies/x is hashed instead of ontologies/fashion
      expect(version(synth({ defaultDomain: DEFAULT_DOMAIN }))).toBe(version(fashion));
    });

    test('only the pipeline function carries a concurrency cap; the API uses the account pool (a page asks for many photos at once)', () => {
      const t = sample;
      expect(fnByHandler(t, API).Properties.ReservedConcurrentExecutions).toBeUndefined();
      expect(fnByHandler(t, PIPELINE).Properties.ReservedConcurrentExecutions).toBe(5);
      // the Map state runs 4 sources at a time: one run fits under the pipeline's cap
      const definition = only(t, 'AWS::StepFunctions::StateMachine').Properties.DefinitionString as string;
      expect(JSON.parse(definition).States['Classify and ingest each source'].MaxConcurrency).toBeLessThan(5);
      // the loader and the auth setup run once per deploy: no cap, nothing to reserve
      for (const handler of [LOADER, AUTH_SETUP]) {
        expect(fnByHandler(t, handler).Properties.ReservedConcurrentExecutions).toBeUndefined();
      }
    });

  });

  describe('the private network (network.ts)', () => {
    let sample: Template;
    beforeAll(() => {
      sample = synth();
    });
    const OWN_TAG = 'multimodal-ai-knowledge-graph:stack-id';
    const ids = (t: Template, type: string): string[] => Object.keys(t.findResources(type)).sort();
    const resource = (t: Template, id: string): any => t.toJSON().Resources[id];
    const vpcRef = (t: Template) => ({ Ref: logicalId(t, 'AWS::EC2::VPC') });

    test('the three functions that call the graph run in the private subnets with the Callers group; the deploy-time functions stay outside', () => {
      const t = sample;
      for (const handler of [API, PIPELINE, LOADER]) {
        expect(fnByHandler(t, handler).Properties.VpcConfig).toEqual({
          SecurityGroupIds: [{ 'Fn::GetAtt': [groupId(t, 'NetworkCallers'), 'GroupId'] }],
          SubnetIds: subnetIds(t).map((id) => ({ Ref: id })),
        });
      }
      // the sign-in set-up and aws-cdk-lib's providers (BucketDeployment, auto-delete, default security group) never call the graph
      const outside = Object.values(t.findResources('AWS::Lambda::Function')).filter((fn: any) => !fn.Properties.VpcConfig) as any[];
      expect(outside.map((fn) => fn.Properties.Handler).sort()).toEqual(
        [AUTH_SETUP, '__entrypoint__.handler', 'index.handler', 'index.handler'].sort(),
      );
      // the functions and the agents use the stack's two groups: nothing creates a group of its own
      expect(ids(t, 'AWS::EC2::SecurityGroup')).toEqual([groupId(t, 'NetworkCallers'), groupId(t, 'NetworkEndpoints')].sort());
    });

    test("no IAM policy names a function from that function's own role (the function depends on its role's policy: a cycle)", () => {
      const t = sample;
      const functions = Object.entries(t.findResources('AWS::Lambda::Function')) as [string, any][];
      const policies = Object.entries(t.findResources('AWS::IAM::Policy')) as [string, any][];
      const names = (policy: any, fnId: string) => {
        const json = JSON.stringify(policy.Properties.PolicyDocument);
        return json.includes(`{"Ref":"${fnId}"}`) || json.includes(`"Fn::GetAtt":["${fnId}",`);
      };
      for (const [fnId, fn] of functions) {
        const roleId = fn.Properties.Role['Fn::GetAtt'][0];
        const own = policies.filter(([, p]) => p.Properties.Roles.some((r: any) => r.Ref === roleId));
        expect(own.filter(([, p]) => names(p, fnId)).map(([id]) => id)).toEqual([]);
      }
      // the only policies that name a function at all: the API's and the state machine's invoke grants on the pipeline function,
      // and the signed-in user's grant on the API function (a role no function runs as)
      const stripHash = (id: string) => id.replace(/[0-9A-F]{8}$/, '');
      const naming = policies.flatMap(([policyId, p]) => functions.filter(([fnId]) => names(p, fnId)).map(([fnId]) => `${stripHash(policyId)} -> ${stripHash(fnId)}`));
      expect(naming.sort()).toEqual([
        'ApiRoleDefaultPolicy -> PipelineFunction',
        'AuthSignedInRoleDefaultPolicy -> ApiFunction',
        'IngestPipelineRoleDefaultPolicy -> PipelineFunction',
      ]);
    });

    test('two private subnets placed by AZ ID, chosen without a lookup; no public subnet', () => {
      const t = sample;
      const subnets = subnetIds(t).map((id) => resource(t, id).Properties);
      expect(subnets.map((s) => s.AvailabilityZoneId)).toEqual(['use1-az1', 'use1-az2']); // the first two AgentCore supports in us-east-1
      for (const subnet of subnets) {
        expect(subnet.AvailabilityZone).toBeUndefined();
        expect(subnet.MapPublicIpOnLaunch).toBe(false);
        expect(subnet.VpcId).toEqual(vpcRef(t));
        expect(subnet.Tags).toContainEqual({ Key: 'aws-cdk:subnet-type', Value: 'Private' });
      }
      expect(subnets.map((s) => s.CidrBlock)).toEqual(['10.0.0.0/20', '10.0.16.0/20']);
      expect(oneOf(t, 'AWS::EC2::VPC').Properties).toEqual(
        expect.objectContaining({ CidrBlock: '10.0.0.0/16', EnableDnsHostnames: true, EnableDnsSupport: true }),
      );
      // the Region's table entry, or the two IDs of -c vpcAzIds= (not checked against the table)
      const azIdsOf = (u: Template) => subnetIds(u).map((id) => resource(u, id).Properties.AvailabilityZoneId);
      expect(azIdsOf(synth({ env: { account: '111111111111', region: 'eu-central-1' } }))).toEqual(['euc1-az1', 'euc1-az2']);
      expect(azIdsOf(synth({ env: { account: '111111111111', region: 'ca-central-1' } }))).toEqual(['cac1-az1', 'cac1-az2']);
      expect(azIdsOf(synth({ vpcAzIds: ['use1-az4', 'use1-az6'] }))).toEqual(['use1-az4', 'use1-az6']);
      expect(() => synth({ env: { account: '111111111111', region: 'af-south-1' } })).toThrow(/-c vpcAzIds=/);
      expect(() => synth({ vpcAzIds: ['use1-az1'] })).toThrow(/vpcAzIds/);
      // nothing is looked up at synth: no missing context, so the CLI writes no cdk.context.json
      const app = new cdk.App({ context: NO_BUNDLING });
      new MultimodalAiKnowledgeGraphStack(app, 'NoLookup', { env: { account: '111111111111', region: 'us-east-1' } });
      expect(app.synth().manifest.missing ?? []).toEqual([]);
    });

    test('one regional NAT gateway serving both AZ IDs with two Elastic IPs, created after the internet gateway is attached; both subnets route to it', () => {
      const t = sample;
      const natId = logicalId(t, 'AWS::EC2::NatGateway');
      const nat = resource(t, natId);
      const [eip1, eip2] = ids(t, 'AWS::EC2::EIP');
      const attachment = logicalId(t, 'AWS::EC2::VPCGatewayAttachment');
      expect(nat.Properties.AvailabilityMode).toBe('regional');
      expect(nat.Properties.ConnectivityType).toBe('public');
      expect(nat.Properties.VpcId).toEqual(vpcRef(t));
      expect(nat.Properties.AvailabilityZoneAddresses).toEqual([
        { AvailabilityZoneId: 'use1-az1', AllocationIds: [{ 'Fn::GetAtt': [eip1, 'AllocationId'] }] },
        { AvailabilityZoneId: 'use1-az2', AllocationIds: [{ 'Fn::GetAtt': [eip2, 'AllocationId'] }] },
      ]);
      expect(nat.DependsOn).toContain(attachment);
      for (const eip of [eip1, eip2]) {
        expect(resource(t, eip).Properties.Domain).toBe('vpc');
        expect(resource(t, eip).DependsOn).toContain(attachment);
      }
      // the internet gateway serves the NAT gateway only: no route points at it
      t.resourceCountIs('AWS::EC2::InternetGateway', 1);
      const routes = ids(t, 'AWS::EC2::Route').map((id) => resource(t, id).Properties);
      expect(routes).toHaveLength(2);
      for (const route of routes) {
        expect(route).toEqual(expect.objectContaining({ DestinationCidrBlock: '0.0.0.0/0', NatGatewayId: { 'Fn::GetAtt': [natId, 'NatGatewayId'] } }));
        expect(route.GatewayId).toBeUndefined();
      }
      expect(routes.map((r) => r.RouteTableId.Ref).sort()).toEqual(ids(t, 'AWS::EC2::RouteTable'));
      // and S3 through a gateway endpoint on both route tables
      expect(oneOf(t, 'AWS::EC2::VPCEndpoint').Properties).toEqual(
        expect.objectContaining({ VpcEndpointType: 'Gateway', RouteTableIds: ids(t, 'AWS::EC2::RouteTable').map((id) => ({ Ref: id })) }),
      );
      expect(JSON.stringify(oneOf(t, 'AWS::EC2::VPCEndpoint').Properties.ServiceName)).toContain('.s3');
    });

    test('Callers: no inbound, HTTPS out only; Endpoints: HTTPS in from Callers only; the default group is emptied', () => {
      const t = sample;
      const callersId = groupId(t, 'NetworkCallers');
      const endpointsId = groupId(t, 'NetworkEndpoints');
      const callers = resource(t, callersId).Properties;
      expect(callers.SecurityGroupIngress).toBeUndefined();
      expect(callers.SecurityGroupEgress).toEqual([expect.objectContaining({ CidrIp: '0.0.0.0/0', IpProtocol: 'tcp', FromPort: 443, ToPort: 443 })]);
      const endpoints = resource(t, endpointsId).Properties;
      expect(endpoints.SecurityGroupIngress).toBeUndefined();
      // aws-cdk-lib's placeholder for "no outbound rule" (a rule that matches no traffic)
      expect(endpoints.SecurityGroupEgress).toEqual([expect.objectContaining({ CidrIp: '255.255.255.255/32', Description: 'Disallow all traffic' })]);
      const ingress = Object.values(t.findResources('AWS::EC2::SecurityGroupIngress')).map((r: any) => r.Properties);
      expect(ingress).toEqual([
        expect.objectContaining({
          GroupId: { 'Fn::GetAtt': [endpointsId, 'GroupId'] },
          SourceSecurityGroupId: { 'Fn::GetAtt': [callersId, 'GroupId'] },
          IpProtocol: 'tcp',
          FromPort: 443,
          ToPort: 443,
        }),
      ]);
      t.resourceCountIs('AWS::EC2::SecurityGroupEgress', 0);
      // the VPC's default group keeps no rule (Security Hub EC2.2)
      expect(oneOf(t, 'Custom::VpcRestrictDefaultSG').Properties.DefaultSecurityGroupId).toEqual({
        'Fn::GetAtt': [logicalId(t, 'AWS::EC2::VPC'), 'DefaultSecurityGroup'],
      });
    });

    test('a flow log of rejected traffic into a 30-day log group the stack creates', () => {
      const t = sample;
      const flowLog = oneOf(t, 'AWS::EC2::FlowLog').Properties;
      const groupLogicalId = Object.keys(t.findResources('AWS::Logs::LogGroup')).find((id) => id.startsWith('NetworkFlowLogsGroup'))!;
      expect(flowLog).toEqual(
        expect.objectContaining({
          ResourceType: 'VPC',
          ResourceId: vpcRef(t),
          TrafficType: 'REJECT',
          LogDestinationType: 'cloud-watch-logs',
          LogGroupName: { Ref: groupLogicalId },
        }),
      );
      const group = resource(t, groupLogicalId).Properties;
      expect(group.RetentionInDays).toBe(30);
      expect(group.LogGroupName).toBeUndefined(); // a retained group never collides with a redeploy
    });

    test('a stack delete keeps what AgentCore may still hold interfaces in, and deletes everything billed per hour', () => {
      const t = sample;
      const resources = t.toJSON().Resources as Record<string, any>;
      const retainedIds = Object.keys(resources).filter((id) => resources[id].DeletionPolicy === 'Retain').sort();
      const flowLogRole = Object.keys(t.findResources('AWS::IAM::Role')).find((id) => id.startsWith('NetworkFlowLogsIAMRole'))!;
      const flowLogPolicy = Object.keys(t.findResources('AWS::IAM::Policy')).find((id) => id.startsWith('NetworkFlowLogsIAMRoleDefaultPolicy'))!;
      const flowLogGroup = Object.keys(t.findResources('AWS::Logs::LogGroup')).find((id) => id.startsWith('NetworkFlowLogsGroup'))!;
      // exactly these, and nothing else in the stack
      expect(retainedIds).toEqual(
        [
          logicalId(t, 'AWS::EC2::VPC'),
          ...subnetIds(t),
          ...ids(t, 'AWS::EC2::RouteTable'),
          groupId(t, 'NetworkCallers'),
          groupId(t, 'NetworkEndpoints'),
          logicalId(t, 'AWS::EC2::FlowLog'),
          flowLogRole,
          flowLogPolicy,
          flowLogGroup,
          logicalId(t, 'Custom::VpcRestrictDefaultSG'), // its Delete would put the default group's rules back
          // the logs bucket's policy: S3 removes it with the bucket, and until then it carries the
          // deny that keeps late log objects out of the emptied bucket (emptyLogsBucketLast)
          Object.entries(t.findResources('AWS::S3::BucketPolicy')).find(([, p]: [string, any]) => p.Properties.Bucket.Ref.startsWith('LogsBucket'))![0],
        ].sort(),
      );
      for (const id of retainedIds) expect(resources[id].UpdateReplacePolicy).toBe('Retain');
      for (const type of [
        'AWS::EC2::NatGateway',
        'AWS::EC2::EIP',
        'AWS::EC2::InternetGateway',
        'AWS::EC2::VPCGatewayAttachment',
        'AWS::EC2::Route',
        'AWS::EC2::VPCEndpoint',
        'AWS::NeptuneGraph::PrivateGraphEndpoint',
      ]) {
        expect(Object.keys(t.findResources(type)).length).toBeGreaterThan(0);
        for (const r of Object.values(t.findResources(type)) as any[]) expect(r.DeletionPolicy ?? 'Delete').toBe('Delete');
      }
    });

    test("every taggable network resource carries the stack's id in the own tag (what network-cleanup finds a retained VPC by)", () => {
      const t = sample;
      const tag = { Key: OWN_TAG, Value: { Ref: 'AWS::StackId' } };
      const taggable = [
        'AWS::EC2::VPC',
        'AWS::EC2::Subnet',
        'AWS::EC2::RouteTable',
        'AWS::EC2::InternetGateway',
        'AWS::EC2::NatGateway',
        'AWS::EC2::EIP',
        'AWS::EC2::VPCEndpoint',
        'AWS::EC2::SecurityGroup',
        'AWS::EC2::FlowLog',
      ];
      for (const type of taggable) {
        for (const r of Object.values(t.findResources(type)) as any[]) {
          expect(r.Properties.Tags).toContainEqual(tag);
          expect(r.Properties.Tags).toContainEqual({ Key: 'project', Value: 'multimodal-ai-knowledge-graph' });
        }
      }
      // the flow log's role and group, which the cleanup command deletes only with the same tag value
      const tagged = (type: string, prefix: string) =>
        (Object.entries(t.findResources(type)).find(([id]) => id.startsWith(prefix))![1] as any).Properties.Tags;
      expect(tagged('AWS::IAM::Role', 'NetworkFlowLogsIAMRole')).toContainEqual(tag);
      expect(tagged('AWS::Logs::LogGroup', 'NetworkFlowLogsGroup')).toContainEqual(tag);
      // only the network: the functions, the graph and the buckets do not carry it
      expect(JSON.stringify(fnByHandler(t, API).Properties.Tags)).not.toContain(OWN_TAG);
      expect(JSON.stringify(oneOf(t, 'AWS::NeptuneGraph::Graph').Properties.Tags)).not.toContain(OWN_TAG);
    });

    test('the loader runs after the graph endpoint and the VPC egress; the API names the VPC and the endpoint; VpcId is an output', () => {
      const t = sample;
      const loader = oneOf(t, 'Custom::GraphLoader');
      expect(loader.DependsOn).toEqual(
        expect.arrayContaining([
          'GraphPrivateEndpoint',
          logicalId(t, 'AWS::EC2::VPCEndpoint'),
          logicalId(t, 'AWS::EC2::VPCGatewayAttachment'),
          ...ids(t, 'AWS::EC2::Route'),
        ]),
      );
      const env = fnByHandler(t, API).Properties.Environment.Variables;
      expect(env.VPC_ID).toEqual(vpcRef(t));
      expect(env.GRAPH_ENDPOINT_ID).toEqual({ 'Fn::GetAtt': ['GraphPrivateEndpoint', 'VpcEndpointId'] });
      for (const handler of [PIPELINE, LOADER]) {
        expect(fnByHandler(t, handler).Properties.Environment.Variables.VPC_ID).toBeUndefined();
      }
      expect(t.toJSON().Outputs.VpcId.Value).toEqual(vpcRef(t));
      // the graph's DNS name stays an output; it now resolves inside the VPC only
      expect(t.toJSON().Outputs.GraphEndpoint.Value).toEqual({ 'Fn::GetAtt': [logicalId(t, 'AWS::NeptuneGraph::Graph'), 'Endpoint'] });
    });
  });
});
