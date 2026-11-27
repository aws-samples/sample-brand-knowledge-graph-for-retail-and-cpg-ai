// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import { Construct, IDependable } from 'constructs';
import type { InputGuardrail } from './guardrail';
import { foundationModels, modelResources } from './models';
import { acknowledgeWildcards, wildcardAction, wildcardResource } from './nag';

/**
 * The two agents of the sample on Amazon Bedrock AgentCore Runtime, and how their code zips are
 * built: `QueryAgent` (tab 2, the Amazon Neptune MCP server) and `LakeAgent` (tab 6's trends question, the S3 Tables
 * MCP server), each a Bedrock Converse tool loop that starts its MCP server per request as a stdio
 * subprocess. AgentCore runs an agent from a code zip (direct code deployment: no container image,
 * no ECR), one microVM per runtime session, behind an IAM-authenticated `InvokeAgentRuntime`
 * endpoint. A runtime's execution role is the only identity the agent and its MCP server have, so
 * each role names the one data store the agent may read and the answer models, nothing else.
 */

/** Python of the runtime, and the wheels the zip is built from (AgentCore runs Linux arm64). */
export const AGENT_RUNTIME = agentcore.AgentCoreRuntime.PYTHON_3_14;
export const AGENT_PYTHON_VERSION = '3.14';
export const AGENT_PYTHON_PLATFORM = 'aarch64-manylinux2014';
/** ADOT wraps the entry point, as the AgentCore CLI does: traces and metrics in CloudWatch. */
export const AGENT_ENTRYPOINT = ['opentelemetry-instrument', 'main.py'];

/**
 * The two agents of the sample, each a code zip of its own: tab 2's query agent (the Amazon Neptune
 * MCP server) and the lake agent (the S3 Tables MCP server, with PyIceberg, PyArrow and Daft;
 * their wheels for Linux arm64 / CPython 3.14 are manylinux_2_28, which AgentCore Runtime runs).
 */
export type AgentKind = 'query' | 'lake';
export const AGENT_BUNDLES: Record<AgentKind, { dir: string; platform: string; pipPlatform: string }> = {
  query: { dir: 'agentcore', platform: AGENT_PYTHON_PLATFORM, pipPlatform: 'manylinux2014_aarch64' },
  lake: { dir: 'agentcore-lake', platform: 'aarch64-manylinux_2_28', pipPlatform: 'manylinux_2_28_aarch64' },
};

/** The lake agent works as a background job (polled), so it may take longer than the API. */
export const LAKE_AGENT_DEADLINE_S = 240;

/**
 * Regions with AgentCore Runtime platform version V2 (snapshot restore: fast, consistent cold
 * starts, billed on what the agent actively uses). Elsewhere the runtime gets the service default (V1).
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html#runtime-platform-versions
 */
export const AGENT_V2_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2', 'eu-west-1', 'ap-northeast-1'];

/**
 * How long the query agent may work on one request (seconds). The API waits 100 s for its answer
 * (backend/src/ontology_rag/vision.py, API_CALL_TIMEOUT_S, under the API function's 115 s). The
 * agent starts no model turn in the last 12 s (query_agent.py, MODEL_TURN_S), so a run ends at
 * about 70 s, and the other 30 s cover the tool calls of its last turn, a new session's first
 * start (the MCP server took 17 s on a fresh microVM) and the way back. The trends question's graph agent job
 * asks for up to 300 s per request instead (`deadline_s`, query_agent.py MAX_DEADLINE_S, checked by
 * the runtime): the pipeline function waits for that one, not the API (PIPELINE_FUNCTION_TIMEOUT_S).
 */
export const AGENT_DEADLINE_S = 70;

export interface QueryAgentProps {
  /** The code zip: `agentCodeAsset()`, a CDK asset. */
  readonly code: AgentCode;
  readonly graphId: string;
  readonly graphArn: string;
  /** The default model, and the models tab 2 may pick (the API's ANSWER_MODEL_IDS). */
  readonly llmModelId: string;
  readonly answerModelIds: string[];
  /** `V1`, `V2`, or `auto` (default): V2 in AGENT_V2_REGIONS, the service default elsewhere. */
  readonly platformVersion?: 'V1' | 'V2' | 'auto';
  /**
   * Traces: the runtime's own delivery to X-Ray and the agent's ADOT spans. Both need CloudWatch
   * Transaction Search in the account (X-Ray trace segment destination = CloudWatch Logs), an
   * account-wide setting this stack does not change; without it the delivery fails to create and
   * the X-Ray endpoint refuses the spans.
   * @default false
   */
  readonly tracing?: boolean;
  /**
   * The guardrail on the typed question (guardrail.ts): named in the runtime's environment and
   * applied by the agent on every model turn.
   */
  readonly guardrail: InputGuardrail;
  /**
   * Where the runtime's network interfaces are. The full stack: VPC mode in its private subnets
   * with the Callers group (network.ts), where the agent reaches the graph through its private
   * endpoint, its code zip through the S3 gateway endpoint, and Bedrock and its logs through the
   * regional NAT gateway.
   */
  readonly network: agentcore.RuntimeNetworkConfiguration;
  /**
   * What the runtime is created after (Network.egressReady): a new VPC-mode runtime fetches its code
   * zip through the VPC, and the Runtime construct adds no dependency on the network itself.
   */
  readonly egressReady: IDependable;
}

/**
 * Tab 2's query agent (backend/agentcore/main.py → ontology_rag.agent_runtime → query_agent.py):
 * openCypher over the graph through the tools of the Amazon Neptune MCP server. Its execution role
 * gets Bedrock `InvokeModel` for the answer models and `neptune-graph:ReadDataViaQuery` on one
 * graph; the agent's keyword guard keeps writes out of the loop, IAM is the boundary.
 */
export class QueryAgent extends Construct {
  readonly runtime: agentcore.Runtime;

  constructor(scope: Construct, id: string, props: QueryAgentProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);

    this.runtime = new agentcore.Runtime(this, 'Runtime', {
      // no runtimeName: CDK derives a unique one from the construct path
      description: 'multimodal-ai-knowledge-graph query agent: openCypher for Neptune Analytics through the Amazon Neptune MCP server',
      agentRuntimeArtifact: props.code.artifact,
      protocolConfiguration: agentcore.ProtocolType.HTTP,
      // Deployed: the graph through its private endpoint, Bedrock through the NAT gateway (props.network).
      networkConfiguration: props.network,
      platformVersion: platformVersion(this, props.platformVersion ?? 'auto'),
      environmentVariables: {
        GRAPH_ID: props.graphId,
        GRAPH_REGION: stack.region,
        LLM_MODEL_ID: props.llmModelId,
        ANSWER_MODEL_IDS: props.answerModelIds.join(','),
        AGENT_DEADLINE_S: String(AGENT_DEADLINE_S),
        ...props.guardrail.environment,
        // Without Transaction Search the X-Ray OTLP endpoint refuses spans (HTTP 400 in the log
        // every few seconds): ADOT then keeps its logs and metrics and drops the spans.
        ...(props.tracing ? {} : { OTEL_TRACES_EXPORTER: 'none' }),
      },
      // One session per browser tab, and one per trends graph agent job: a session idle for 10
      // minutes gives its microVM back (a request that works is not idle; AgentCore ends one after
      // 15 minutes), and no session lives longer than two hours (service defaults: 15 minutes, 8 hours).
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: cdk.Duration.minutes(10),
        maxLifetime: cdk.Duration.hours(2),
      },
      // The agent's own spans and metrics come from ADOT (the entry point); the runtime's trace
      // delivery to X-Ray is opt-in because it requires Transaction Search (see `tracing`).
      tracingEnabled: props.tracing ?? false,
    });
    this.runtime.node.addDependency(props.egressReady);

    // The default execution role (trusted by bedrock-agentcore.amazonaws.com for this account
    // and runtime) may write its logs, traces and metrics. The agent adds: the answer models ...
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AnswerModels',
        actions: ['bedrock:InvokeModel'],
        resources: modelResources(stack, props.answerModelIds),
      }),
    );
    // ... and reading the graph: ExecuteQuery with a read-only query. Writes are denied by IAM.
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ReadGraph',
        actions: ['neptune-graph:ReadDataViaQuery'],
        resources: [props.graphArn],
      }),
    );
    // ... and the guardrail on the typed question.
    props.guardrail.grantApply(this.runtime, this.runtime);
    grantRuntimeLogGroupPolicy(this.runtime);
    acknowledgeRuntimeWildcards(this.runtime, props.code.bucket);
  }
}

/**
 * The runtime's log group is the service's: AgentCore creates
 * `/aws/bedrock-agentcore/runtimes/<runtime id>-DEFAULT` the moment the runtime exists (a first
 * deploy that declared the same group in the stack failed with AlreadyExists), so the stack does
 * not own it and `cdk destroy` leaves it behind. The role below is what the service needs to write
 * into it; README "Cleanup" names the two groups to delete by hand.
 *
 * AgentCore sets a resource policy on the runtime's own log group with this role (the AgentCore
 * CLI grants the same; without it CloudTrail records an AccessDenied on every start).
 */
function grantRuntimeLogGroupPolicy(runtime: agentcore.Runtime): void {
  runtime.addToRolePolicy(
    new iam.PolicyStatement({
      sid: 'RuntimeLogGroupPolicy',
      actions: ['logs:PutResourcePolicy'],
      resources: [runtimeLogGroups(cdk.Stack.of(runtime), '/aws/bedrock-agentcore/runtimes/*')],
    }),
  );
}

function runtimeLogGroups(stack: cdk.Stack, name: string): string {
  return stack.formatArn({ service: 'logs', resource: 'log-group', resourceName: name, arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME });
}

/**
 * The wildcards in a runtime's execution role, acknowledged for cdk-nag: the statements the Runtime
 * construct adds for the service (its log group and streams under the service's prefix, its workload
 * identity, X-Ray and CloudWatch metrics, the code zip), and the foundation models behind the profiles.
 */
function acknowledgeRuntimeWildcards(runtime: agentcore.Runtime, codeBucket: s3.IBucket): void {
  const stack = cdk.Stack.of(runtime);
  acknowledgeWildcards(
    runtime,
    'AgentCore Runtime names the log group after the runtime (/aws/bedrock-agentcore/runtimes/<id>-DEFAULT) and sets a resource ' +
      'policy on it, writes log streams under it, and reads its workload identity: resource patterns of the service, added by the Runtime construct',
    wildcardResource(runtime, runtimeLogGroups(stack, '/aws/bedrock-agentcore/runtimes/*')),
    wildcardResource(runtime, runtimeLogGroups(stack, '*')),
    wildcardResource(runtime, runtimeLogGroups(stack, '/aws/bedrock-agentcore/runtimes/*:log-stream:*')),
    wildcardResource(
      runtime,
      stack.formatArn({ service: 'bedrock-agentcore', resource: 'workload-identity-directory', resourceName: 'default/workload-identity/*' }),
    ),
  );
  acknowledgeWildcards(
    runtime,
    'xray:PutTraceSegments and cloudwatch:PutMetricData take no resource ARN (the metrics statement is conditioned on the bedrock-agentcore namespace)',
    'Resource::*',
  );
  acknowledgeWildcards(
    runtime,
    'the runtime reads its code zip from the CDK assets bucket: grantRead by the Runtime artifact',
    wildcardAction('s3:GetObject*'),
    wildcardAction('s3:GetBucket*'),
    wildcardAction('s3:List*'),
    wildcardResource(runtime, codeBucket.arnForObjects('*')),
  );
  acknowledgeWildcards(
    runtime,
    'cross-Region and global inference profiles route to foundation models in other Regions: InvokeModel is authorized on the listed profiles and on the models they resolve to',
    wildcardResource(runtime, foundationModels(stack)),
  );
}

export interface LakeAgentProps {
  /** The code zip: `agentCodeAsset(scope, repoRoot, 'lake')`. */
  readonly code: AgentCode;
  /** The sample's S3 table bucket (tab 6's trends question, method 2): the only data the agent may touch. */
  readonly tableBucketArn: string;
  /** The two tables the stack creates next to the bucket: the only tables the role names. */
  readonly tableArns: string[];
  readonly llmModelId: string;
  readonly answerModelIds: string[];
  readonly platformVersion?: 'V1' | 'V2' | 'auto';
  readonly tracing?: boolean;
  /**
   * As for the query agent. In the full stack's VPC the lake agent reaches S3 Tables (its control
   * API and the Iceberg REST endpoint) and Bedrock through the NAT gateway and the tables' data
   * files through the S3 gateway endpoint; it shares the Callers group, and its role has no graph
   * permission.
   */
  readonly network: agentcore.RuntimeNetworkConfiguration;
  /** As for the query agent: what the runtime is created after (Network.egressReady). */
  readonly egressReady: IDependable;
}

/**
 * The lake agent on Amazon Bedrock AgentCore Runtime (backend/agentcore-lake/main.py →
 * ontology_rag.agent_runtime.handle_lake). Two jobs: write the rows the API read from the graph
 * into the sample's Iceberg tables (PyIceberg, the S3 Tables Iceberg REST endpoint), and answer a
 * question about them with a Converse tool loop over the S3 Tables MCP server, started read-only, as
 * a background job the API polls in the same session. Its execution role reaches the one table
 * bucket and the answer models, never the graph.
 */
export class LakeAgent extends Construct {
  readonly runtime: agentcore.Runtime;

  constructor(scope: Construct, id: string, props: LakeAgentProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    this.runtime = new agentcore.Runtime(this, 'Runtime', {
      description: 'multimodal-ai-knowledge-graph lake agent: SQL over the graph exported to Iceberg tables, through the S3 Tables MCP server',
      agentRuntimeArtifact: props.code.artifact,
      protocolConfiguration: agentcore.ProtocolType.HTTP,
      networkConfiguration: props.network,
      platformVersion: platformVersion(this, props.platformVersion ?? 'auto'),
      environmentVariables: {
        TABLE_BUCKET_ARN: props.tableBucketArn,
        LAKE_REGION: stack.region,
        LLM_MODEL_ID: props.llmModelId,
        ANSWER_MODEL_IDS: props.answerModelIds.join(','),
        LAKE_AGENT_DEADLINE_S: String(LAKE_AGENT_DEADLINE_S),
        // Daft, the query engine of the S3 Tables MCP server, sends usage pings to third parties
        // unless opted out; the MCP subprocess gets the same variable (mcp_agent.subprocess_env).
        DO_NOT_TRACK: 'true',
        ...(props.tracing ? {} : { OTEL_TRACES_EXPORTER: 'none' }),
      },
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: cdk.Duration.minutes(10),
        maxLifetime: cdk.Duration.hours(2),
      },
      tracingEnabled: props.tracing ?? false,
    });
    this.runtime.node.addDependency(props.egressReady);
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AnswerModels',
        actions: ['bedrock:InvokeModel'],
        resources: modelResources(stack, props.answerModelIds),
      }),
    );
    // The Iceberg REST endpoint: read the bucket, namespace and tables (query_database), and
    // commit new snapshots of the two tables (the export). No CreateTable, no Delete*.
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'SampleTableBucket',
        actions: [
          's3tables:GetTableBucket',
          's3tables:GetNamespace',
          's3tables:ListNamespaces',
          's3tables:ListTables',
          's3tables:GetTable',
          's3tables:GetTableMetadataLocation',
          's3tables:GetTableData',
          's3tables:PutTableData',
          's3tables:UpdateTableMetadataLocation',
        ],
        resources: [props.tableBucketArn, ...props.tableArns],
      }),
    );
    grantRuntimeLogGroupPolicy(this.runtime);
    acknowledgeRuntimeWildcards(this.runtime, props.code.bucket);
  }
}

function platformVersion(scope: Construct, choice: 'V1' | 'V2' | 'auto'): agentcore.PlatformVersion | undefined {
  if (choice !== 'auto') return agentcore.PlatformVersion.of(choice);
  // The stack is bound to the deployer's Region (context.ts); without one, the service default.
  const region = cdk.Stack.of(scope).region;
  return !cdk.Token.isUnresolved(region) && AGENT_V2_REGIONS.includes(region) ? agentcore.PlatformVersion.V2 : undefined;
}

/** An agent's code zip for AgentCore Runtime, and the bucket it is read from (what the execution role is granted). */
export interface AgentCode {
  readonly artifact: agentcore.AgentRuntimeArtifact;
  readonly bucket: s3.IBucket;
}

/** An agent's zip as a CDK asset in the bootstrap bucket, built locally (copyAgentBundle), without Docker. */
export function agentCodeAsset(scope: Construct, repoRoot: string, kind: AgentKind = 'query'): AgentCode {
  const asset = new s3_assets.Asset(scope, `${kind === 'lake' ? 'Lake' : 'Query'}AgentCode`, {
    path: path.join(repoRoot, 'backend', AGENT_BUNDLES[kind].dir),
    assetHashType: cdk.AssetHashType.OUTPUT,
    bundling: {
      image: cdk.DockerImage.fromRegistry('public.ecr.aws/docker/library/python:3.14-slim'),
      local: {
        tryBundle(outputDir: string): boolean {
          copyAgentBundle(repoRoot, outputDir, kind);
          return true;
        },
      },
    },
  });
  return { artifact: agentCodeAt(asset.s3BucketName, asset.s3ObjectKey), bucket: asset.bucket };
}

function agentCodeAt(bucketName: string, objectKey: string): agentcore.AgentRuntimeArtifact {
  return agentcore.AgentRuntimeArtifact.fromS3({ bucketName, objectKey }, AGENT_RUNTIME, AGENT_ENTRYPOINT);
}

/**
 * An agent zip's content, the output of the CDK asset's local bundling:
 * main.py at the root, the ontology_rag package, and the pinned and hashed dependency closure of
 * backend/<agentcore | agentcore-lake>/requirements.txt (`uv pip compile --generate-hashes`) as
 * Linux arm64 wheels for CPython 3.14, what the AgentCore CLI's packager does. --require-hashes makes
 * the installer refuse a wheel that does not match the hash the file records.
 */
export function copyAgentBundle(repoRoot: string, outputDir: string, kind: AgentKind = 'query'): void {
  const { execFileSync, spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const bundle = AGENT_BUNDLES[kind];
  const agentDir = path.join(repoRoot, 'backend', bundle.dir);
  const requirements = path.join(agentDir, 'requirements.txt');
  const common = ['--no-deps', '--only-binary=:all:', '--require-hashes', '--target', outputDir, '-r', requirements];
  if (spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0) {
    execFileSync(
      'uv',
      ['pip', 'install', '--quiet', '--python-version', AGENT_PYTHON_VERSION, '--python-platform', bundle.platform, ...common],
      { stdio: 'inherit' },
    );
  } else {
    const platform = ['--platform', bundle.pipPlatform, '--implementation', 'cp', '--python-version', AGENT_PYTHON_VERSION];
    execFileSync('python3', ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--no-compile', ...platform, ...common], {
      stdio: 'inherit',
    });
  }
  const skipCache = (p: string) => !p.includes('__pycache__');
  fs.cpSync(path.join(repoRoot, 'backend', 'src', 'ontology_rag'), path.join(outputDir, 'ontology_rag'), {
    recursive: true,
    filter: skipCache,
  });
  fs.copyFileSync(path.join(agentDir, 'main.py'), path.join(outputDir, 'main.py'));
  // Console scripts carry the build machine's interpreter in their shebang: keep the entry point
  // AgentCore starts, with a portable one, and drop the rest (rdfpipe, uvicorn, ...).
  const bin = path.join(outputDir, 'bin');
  fs.rmSync(bin, { recursive: true, force: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'opentelemetry-instrument'),
    [
      '#!/usr/bin/env python3',
      'import re',
      'import sys',
      'from opentelemetry.instrumentation.auto_instrumentation import run',
      "if __name__ == '__main__':",
      "    sys.argv[0] = re.sub(r'(-script\\.pyw|\\.exe)?$', '', sys.argv[0])",
      '    sys.exit(run())',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  // Installer metadata is not needed at runtime (and would make the asset hash vary).
  for (const entry of fs.readdirSync(outputDir)) {
    if (entry.endsWith('.dist-info')) {
      for (const f of ['RECORD', 'INSTALLER', 'REQUESTED', 'direct_url.json', 'uv_cache.json']) {
        fs.rmSync(path.join(outputDir, entry, f), { force: true });
      }
    }
  }
  compileBytecode(outputDir);
}

/**
 * The code directory of an AgentCore Runtime (/var/task) is read-only, so Python cannot cache
 * bytecode there: every process (the agent, and the MCP server it starts for each request)
 * would compile all its imports again (measured: 2.7 s for the MCP server in a warm session, 9.6 s
 * in a new one). The zip therefore ships the bytecode, compiled by CPython 3.14 (any 3.14.x: one
 * magic number) as unchecked-hash .pyc files, which stay valid whatever mtime the unzipped
 * sources get. Without a local 3.14 the zip still works, only slower.
 */
function compileBytecode(outputDir: string): void {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const found = spawnSync('uv', ['python', 'find', AGENT_PYTHON_VERSION], { encoding: 'utf8' });
  const python = found.status === 0 ? found.stdout.trim() : `python${AGENT_PYTHON_VERSION}`;
  const done = spawnSync(
    python,
    ['-m', 'compileall', '-q', '-j', '0', '--invalidation-mode', 'unchecked-hash', '-x', '/bin/', outputDir],
    { encoding: 'utf8', env: { ...process.env, PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '' } },
  );
  if (done.error) {
    console.warn(`agent zip: no Python ${AGENT_PYTHON_VERSION} to precompile bytecode (${done.error.message}); the runtime compiles on import`);
  } else if (done.status !== 0) {
    // A few packages ship templates that are not valid Python; everything else is compiled.
    console.warn(`agent zip: compileall reported ${(done.stdout.match(/\*\*\*/g) ?? []).length} files it could not compile`);
  }
}
