// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as neptunegraph from 'aws-cdk-lib/aws-neptunegraph';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3tables from 'aws-cdk-lib/aws-s3tables';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct, IConstruct } from 'constructs';
import { agentCodeAsset, LakeAgent, QueryAgent } from './agents';
import { InputGuardrail } from './guardrail';
import { Auth } from './auth';
import { bundledCode, contentHash, LAMBDA_RUNTIME } from './bundling';
import { functionLogging } from './function-logging';
import { foundationModels, modelResources } from './models';
import { acknowledgeWildcards, wildcardAction, wildcardResource } from './nag';
import { Network, resolveAzIds } from './network';

/**
 * Default vision models for the ontology explorer: the current generation of every multimodal
 * model family on Bedrock through global cross-Region inference profiles; mirrors
 * DEFAULT_VISION_MODEL_IDS in backend/src/ontology_rag/config.py.
 */
export const DEFAULT_VISION_MODEL_IDS = [
  'global.anthropic.claude-sonnet-5-5',
  'global.anthropic.claude-opus-5-5',
  'global.anthropic.claude-haiku-5-5',
  'global.openai.gpt-6.1-sol',
  'global.openai.gpt-6.1-terra',
  'global.openai.gpt-6-astra',
  'global.amazon.nova-2-lite-v1:0',
  'global.xai.grok-4.7',
  'global.moonshotai.kimi-k3',
];

/**
 * The domain folder under ontologies/ the graph is built from (ontologies/<domain>/<domain>.ttl);
 * the sample ships this one. Mirrors DEFAULT_DOMAIN in backend/src/ontology_rag/config.py.
 */
export const DEFAULT_DOMAIN = 'fashion';

/**
 * How long a browser request to the API may take (seconds). The browser calls the API's function
 * URL directly, so the function's timeout is the limit, and each call inside stops before it, so a
 * slow call ends with the API's own JSON error:
 * - The API function stops after 115 s.
 * - Every call the function waits for, to a model or to the query agent, gets 100 s and one attempt
 *   (backend/src/ontology_rag/vision.py, API_CALL_TIMEOUT_S), so it ends before the function does.
 *   GPT-5.6 Sol, the slowest model, took up to 65 s for an outfit photo of 1248 x 1824 px.
 */
export const API_FUNCTION_TIMEOUT_S = 115;

/**
 * How long the pipeline function may run (seconds): an ingest step (one slow vision model call, or
 * one ingest with embeddings) and the graph agent's background job of tab 6's trends question,
 * which the API starts and the browser polls. 360 s, not the 300 s an ingest step needs, for that
 * job: it waits 5 s + 345 s for the query agent's runtime, whose deadline is 300 s (backend
 * query_agent.py has the chain; jobs.FunctionJobs.RUN_S is the same number). Nothing waits for it
 * but the browser's poll.
 */
export const PIPELINE_FUNCTION_TIMEOUT_S = 360;

export interface MultimodalAiKnowledgeGraphStackProps extends cdk.StackProps {
  /** Neptune Analytics provisioned memory (m-NCUs). Minimum 16. */
  readonly graphMemory?: number;
  /** Vector index dimension; must match the embedding model output (Nova MME: 256|384|1024|3072). */
  readonly embeddingDimension?: number;
  readonly embeddingModelId?: string;
  readonly llmModelId?: string;
  /** Vision models offered by the ontology explorer (model or inference-profile ids). */
  readonly visionModelIds?: string[];
  /**
   * Models offered for the grounded answers of tab 3 (ANSWER_MODEL_IDS). Defaults to the vision
   * model list, so a deployment that narrows the vision models narrows these too. The default
   * answer model is `llmModelId`, which must be in this list.
   */
  readonly answerModelIds?: string[];
  /**
   * Let the openCypher console run write clauses and `POST /api/admin/clear-graph` empty the graph
   * (default false). Only then does the API's role get the graph's write and delete actions.
   */
  readonly allowWriteQueries?: boolean;
  /**
   * Let the architecture panel show the API's own log lines for the request that was just made
   * (EXPLORER_LOGS, default false). The lines are not redacted, so turn it on only where the
   * signed-in users may read the API's logs, as in a workshop account.
   */
  readonly explorerLogs?: boolean;
  /**
   * Empty the graph and the catalog index before this deploy's load (default false). Use it once
   * after renaming or removing a data set, because the load merges and would otherwise leave the
   * old set's nodes and products next to the new ones. The next deploy without it loads again,
   * which changes nothing: the load is idempotent.
   */
  readonly resetGraph?: boolean;
  /**
   * The domain whose ontology the graph is built from: the functions' ONTOLOGY_PATH, and the
   * folder whose files re-run the loader when they change. A folder of ontologies/ (default `fashion`).
   */
  readonly defaultDomain?: string;
  /** AgentCore Runtime platform version of the query agent (default `auto`: V2 where available). */
  readonly agentPlatformVersion?: 'V1' | 'V2' | 'auto';
  /** Deliver the query agent runtime's traces to X-Ray (needs CloudWatch Transaction Search). */
  readonly agentTracing?: boolean;
  /**
   * Origins that may show the site in a frame, for example a slide deck served from
   * `http://localhost:3030`. Default none: the site sends `frame-ancestors 'none'` and
   * `X-Frame-Options: DENY`. Each entry is a scheme, a host and an optional port; plain http only
   * for localhost and 127.0.0.1. Framed, the app signs in through a popup (managed login refuses
   * to be framed), and the API still verifies every request's token.
   */
  readonly frameAncestors?: string[];
  /**
   * The two AZ IDs of the VPC's private subnets (`-c vpcAzIds=use1-az1,use1-az2`). Default: the first
   * two AgentCore supports in the Region (network.ts, AGENTCORE_AZ_IDS); required for a Region that
   * table lacks and for a stack without a Region. Fixed at the first deploy: a change replaces the
   * subnets, which AgentCore holds for up to 8 hours.
   */
  readonly vpcAzIds?: string[];
  /** Repo root (defaults to two levels above infra/lib). */
  readonly repoRoot?: string;
}

/**
 * The sample's one stack, assembled from sections in the order a reader meets them: the network
 * (the VPC the graph and its callers live in), the graph and the stores (data bucket, S3 Vectors
 * index, Iceberg tables), the two agents, the API, the ingest pipeline, the deploy-time loader, the
 * web site, how the site and the ontologies get into their buckets, the sign-in, the outputs. Each
 * section is a function with the stack as its scope, so a resource's construct path, and with it
 * the logical id CloudFormation keys the deployed resource on, is the same as if it were created in
 * the constructor (test/logical-ids.test.ts pins the full list).
 */
export class MultimodalAiKnowledgeGraphStack extends cdk.Stack {
  /** The two AZ IDs of the VPC (network.ts resolveAzIds), resolved before anything else. */
  private readonly azIds: string[];

  constructor(scope: Construct, id: string, props: MultimodalAiKnowledgeGraphStackProps = {}) {
    super(scope, id, props);
    // First: ec2.Vpc reads the stack's availabilityZones (the getter below) when it is created.
    this.azIds = resolveAzIds(this.region, props.vpcAzIds);
    const settings = withDefaults(props);
    const suffix = stackSuffix();
    const network = addNetwork(this, this.azIds);
    const graph = addGraph(this, settings);
    const graphEndpoint = addGraphEndpoint(this, graph, network);
    const buckets = addDataBuckets(this);
    const vectors = addVectorIndex(this, settings.embeddingDimension);
    const lake = addLakehouse(this, settings.repoRoot, suffix);
    const guardrail = new InputGuardrail(this, 'InputGuardrail', { name: cdk.Fn.join('-', ['multimodal-ai-kg', suffix]) });
    const shared = functionDefaults(this, settings, graph, buckets, guardrail, network);
    const agents = addAgents(this, settings, graph, lake, guardrail, network);
    const api = addApi(this, settings, shared, buckets, vectors, lake, agents);
    // Tab 0 says the graph is private and names the VPC and the endpoint its counts came through
    // (backend setup.status), as AGENT_RUNTIME_ARN names the agent.
    api.fn.addEnvironment('VPC_ID', network.vpc.vpcId);
    api.fn.addEnvironment('GRAPH_ENDPOINT_ID', graphEndpoint.attrVpcEndpointId);
    const pipeline = addIngestPipeline(this, settings.repoRoot, shared, buckets, api.fn);
    // The model calls that carry typed text name the guardrail (backend guardrail.py): the API's
    // (tabs 3 to 6) and the pipeline's (an uploaded text in tab 2). The loader calls no chat model.
    guardrail.grantApply(api.fn, api.fn);
    guardrail.grantApply(pipeline.fn, pipeline.fn);
    addTrendJobs(this, settings, buckets, api.fn, pipeline.fn, agents);
    const loader = addLoader(this, settings, shared, buckets, graph, vectors, graphEndpoint, network);
    // The site's CSP names the managed-login host, and the Auth construct that owns it comes after
    // the distribution (its app client needs the site URL): a lazy value, read when the template is rendered.
    const site = addWebSite(this, buckets.logs, cdk.Lazy.string({ produce: () => auth.domainHost }), settings.frameAncestors);
    const auth = addSignIn(this, site.url, suffix, shared);
    const apiUrl = addApiUrl(api.fn, auth, site.url);
    const ontologiesDeploy = addDeploy(this, settings.repoRoot, buckets, site, webConfig(this, auth, apiUrl));
    // The loader reads the data sets from the data bucket, so it runs once the ontologies are there.
    loader.node.addDependency(ontologiesDeploy);
    emptyLogsBucketLast(buckets.logs, [buckets.data, site.bucket, site.distribution]);
    addOutputs(this, { graph, network, buckets, vectors, agents, api, apiUrl, pipeline, site, embeddingDimension: settings.embeddingDimension });
  }

  /**
   * Where ec2.Vpc places its subnets: the two AZ IDs instead of zone names, the extension point CDK
   * documents for choosing a stack's AZs. Nothing is looked up at synth (no cdk.context.json, no
   * lookup role), and Network gives each subnet its zone as AvailabilityZoneId.
   */
  override get availabilityZones(): string[] {
    return this.azIds;
  }
}

/**
 * Where the data bucket keeps the ontology folders, with their data sets
 * (ontologies/<domain>/datasets/<set>/) and the sets' photos (media/<sub>/ of a set).
 */
const ONTOLOGIES_PREFIX = 'ontologies/';
/** The job records of the trends question's graph agent job (method 1; jobs/trends/<id>.json; backend jobs.TREND_RECORDS). */
const JOBS_PREFIX = 'jobs/';
const TREND_JOBS_PREFIX = `${JOBS_PREFIX}trends/`;

/** The props with their defaults applied: what every section reads. */
interface Settings {
  readonly repoRoot: string;
  readonly graphMemory: number;
  readonly embeddingDimension: number;
  readonly embeddingModelId: string;
  readonly llmModelId: string;
  readonly visionModelIds: string[];
  readonly answerModelIds: string[];
  readonly allowWriteQueries: boolean;
  readonly explorerLogs: boolean;
  readonly resetGraph: boolean;
  readonly defaultDomain: string;
  readonly agentPlatformVersion?: 'V1' | 'V2' | 'auto';
  readonly agentTracing?: boolean;
  readonly frameAncestors: string[];
}

function withDefaults(props: MultimodalAiKnowledgeGraphStackProps): Settings {
  const visionModelIds = props.visionModelIds ?? DEFAULT_VISION_MODEL_IDS;
  return {
    repoRoot: props.repoRoot ?? path.resolve(__dirname, '..', '..'),
    graphMemory: props.graphMemory ?? 16,
    embeddingDimension: props.embeddingDimension ?? 1024,
    embeddingModelId: props.embeddingModelId ?? 'amazon.nova-2-multimodal-embeddings-v1:0',
    llmModelId: props.llmModelId ?? 'global.anthropic.claude-sonnet-5-5',
    visionModelIds,
    answerModelIds: props.answerModelIds ?? visionModelIds,
    allowWriteQueries: props.allowWriteQueries ?? false,
    explorerLogs: props.explorerLogs ?? false,
    resetGraph: props.resetGraph ?? false,
    defaultDomain: props.defaultDomain ?? DEFAULT_DOMAIN,
    agentPlatformVersion: props.agentPlatformVersion,
    agentTracing: props.agentTracing,
    frameAncestors: checkFrameAncestors(props.frameAncestors ?? []),
  };
}

/**
 * The origins allowed to frame the site, checked at synth: no wildcards, paths, keywords or
 * schemes other than https (http only on the loopback hosts), so a typo cannot open framing to
 * every site.
 */
export function checkFrameAncestors(origins: string[]): string[] {
  const portOk = (origin: string) => {
    const port = /:(\d+)$/.exec(origin)?.[1];
    return port === undefined || (Number(port) >= 1 && Number(port) <= 65535);
  };
  for (const origin of origins) {
    const ok = (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)) && portOk(origin);
    if (!ok) {
      throw new Error(
        `frameAncestors: "${origin}" is not an origin this stack accepts. Use https://host[:port], or http://localhost[:port] / http://127.0.0.1[:port]`,
      );
    }
  }
  return origins;
}

/** First block of the stack id: keeps the table bucket, the managed-login domain and the secret unique per stack. */
function stackSuffix(): string {
  return cdk.Fn.select(0, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))));
}

// ------------------------------------------------------------------ the network (network.ts)

function addNetwork(stack: cdk.Stack, azIds: string[]): Network {
  // The graph accepts connections only from this VPC: the three functions that call it and both
  // agents run in its private subnets. The deploy-time functions that never call the graph (the
  // sign-in set-up, aws-cdk-lib's BucketDeployment, auto-delete and default-security-group
  // providers) stay outside it, and Step Functions invokes the pipeline function through the
  // Lambda API, which a function's VPC does not affect.
  return new Network(stack, 'Network', { azIds });
}

// ------------------------------------------------------------------ Neptune Analytics graph

function addGraph(stack: cdk.Stack, settings: Settings): neptunegraph.CfnGraph {
  // The vector index (dimension) can only be set at creation time, and there is one index per graph.
  return new neptunegraph.CfnGraph(stack, 'Graph', {
    provisionedMemory: settings.graphMemory,
    replicaCount: 0, // demo: no standby replica (cuts cost roughly in half)
    publicConnectivity: false, // reachable only through the private graph endpoint in the stack's VPC
    deletionProtection: false,
    vectorSearchConfiguration: { vectorSearchDimension: settings.embeddingDimension },
  });
}

function addGraphEndpoint(stack: cdk.Stack, graph: neptunegraph.CfnGraph, network: Network): neptunegraph.CfnPrivateGraphEndpoint {
  // One interface in each private subnet (the endpoint needs a subnet in every AZ of the VPC), open
  // to the Callers group only. Every property replaces the endpoint, and a new one for the same
  // graph and VPC collides with the old, so like the subnets it is fixed at the first deploy.
  return new neptunegraph.CfnPrivateGraphEndpoint(stack, 'GraphPrivateEndpoint', {
    graphIdentifier: graph.attrGraphId,
    vpcId: network.vpc.vpcId,
    subnetIds: network.privateSubnets.map((subnet) => subnet.subnetId),
    securityGroupIds: [network.endpoints.securityGroupId],
  });
}

// ------------------------------------------------------------------ access logs + data bucket

interface DataBuckets {
  /** CloudFront standard logs and the server access logs of the other two buckets. */
  readonly logs: s3.Bucket;
  /** The ontology folders with their data sets and the sets' photos, the ingest pipeline's uploads and run records. */
  readonly data: s3.Bucket;
}

function addDataBuckets(stack: cdk.Stack): DataBuckets {
  // CloudFront standard logs and the S3 server access logs of the two buckets below, kept for 30
  // days. CloudFront writes its logs with the bucket ACL, so the bucket keeps ACLs enabled
  // (OBJECT_WRITER) and grants the log delivery group. Nothing reads the logs but an operator.
  const logsBucket = new s3.Bucket(stack, 'LogsBucket', {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    versioned: false,
    objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
    accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
    lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  });
  cdk.Validations.of(logsBucket).acknowledge({
    id: 'AwsSolutions-S1',
    reason: 'this is the access-log bucket of the stack; logging its own access would write into itself',
  });

  // The ontologies/ folder (OWL files, example images and texts, data sets) is data, not code: it
  // lives in its own bucket so a new ontology folder can be uploaded without redeploying the
  // Lambda (the API re-lists the prefix every minute). The copy bundled with the code is only the
  // fallback.
  // The ingest pipeline keeps its short-lived data in the same bucket under two more prefixes:
  // uploads/<run>/ (the sources a browser sent) and runs/<run>/ (one record per source).
  // An explicit name with the same prefix as the sign-in secret, so the workshop's participant
  // policy can scope its read access to this bucket (arn:aws:s3:::multimodal-ai-knowledge-graph-*);
  // a generated name has no documented, stable form. Account and Region keep it globally unique
  // (one copy of the app per account and Region) and within S3's 63 characters.
  const ontologiesBucket = new s3.Bucket(stack, 'OntologiesBucket', {
    bucketName: `multimodal-ai-knowledge-graph-data-${stack.account}-${stack.region}`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    versioned: false,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    lifecycleRules: [
      { prefix: 'uploads/', expiration: cdk.Duration.days(1) },
      { prefix: 'runs/', expiration: cdk.Duration.days(7) },
      // The records of the background jobs the browser polls (addTrendJobs): read for minutes, kept a day.
      { prefix: JOBS_PREFIX, expiration: cdk.Duration.days(1) },
    ],
    serverAccessLogsBucket: logsBucket,
    serverAccessLogsPrefix: 'data/',
  });
  return { logs: logsBucket, data: ontologiesBucket };
}

/**
 * On `cdk destroy`, empty the logs bucket only after everything that writes into it is gone. S3
 * server access logs arrive minutes after the request, so the requests that empty the data bucket
 * land in the logs bucket long after an early emptying, and the bucket's delete then fails with
 * "not empty". CloudFormation deletes a resource before the resources it depends on, so the writers
 * depend on the emptying: they go first, and the emptying runs just before the bucket's own delete.
 */
function emptyLogsBucketLast(logsBucket: s3.Bucket, writers: IConstruct[]): void {
  const emptying = logsBucket.node.findChild('AutoDeleteObjectsCustomResource');
  for (const writer of writers) writer.node.addDependency(emptying);
  // Before emptying, aws-cdk-lib's handler adds a deny on s3:PutObject to the bucket policy, but
  // CloudFormation deletes that policy a second later, before the bucket, and late log objects can
  // land in between. Kept, the policy goes with the bucket's own delete and the deny holds until then.
  logsBucket.policy!.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
}

/** cdk-nag: what a function gets from `grantRead(data)` on the data bucket. */
function readsDataBucket(fn: lambda.Function, data: s3.Bucket): void {
  acknowledgeWildcards(
    fn,
    'reads the whole data bucket: the ontology folders under ontologies/ (any folder uploaded later is listed too), the example ' +
      'sources, the uploads and run records of the ingest pipeline and the data sets\' photos; grantRead spells read-only ' +
      'access as s3:GetObject*, s3:GetBucket* and s3:List*',
    wildcardAction('s3:GetObject*'),
    wildcardAction('s3:GetBucket*'),
    wildcardAction('s3:List*'),
    wildcardResource(fn, data.arnForObjects('*')),
  );
}

/** cdk-nag: writes under one prefix of the data bucket, one object per request-time key (grantPut: PutObject* and Abort*). */
function writesDataPrefix(fn: lambda.Function, data: s3.Bucket, reason: string, ...prefixes: string[]): void {
  acknowledgeWildcards(
    fn,
    `${reason}; grantPut spells a write as s3:PutObject with s3:Abort* for an interrupted multipart upload`,
    wildcardAction('s3:Abort*'),
    ...prefixes.map((p) => wildcardResource(fn, data.arnForObjects(`${p}*`))),
  );
}

// ------------------------------------------------------------------ the product catalog on Amazon S3 Vectors

interface VectorIndex {
  /** The product catalog (CATALOG_INDEX). */
  readonly index: s3vectors.CfnIndex;
  /** The bucket's name, cut out of its ARN (the functions' VECTOR_BUCKET). */
  readonly bucketName: string;
  readonly indexName: string;
}

function addVectorIndex(stack: cdk.Stack, embeddingDimension: number): VectorIndex {
  // The data sets' product catalog (payoff.py): every product embedded from its text with the same
  // model as the graph's nodes, in one S3 Vectors index. RAG and GraphRAG both find real products
  // here, as a retailer's product search does; the styling knowledge is in the graph. The loader
  // fills it at deploy from every data set of the graph's domain: a set's catalog.json
  // (precomputed vectors), or the products of its items.json embedded from their text.
  // CloudFormation names the vector bucket (unique per stack); its Ref is the ARN, so the functions
  // get the name from the ARN
  // (arn:<partition>:s3vectors:<region>:<account>:bucket/<name>). L1 resources only.
  const vectorBucket = new s3vectors.CfnVectorBucket(stack, 'VectorBucket', {
    encryptionConfiguration: { sseType: 'AES256' },
  });
  const bucketName = cdk.Fn.select(1, cdk.Fn.split('/', vectorBucket.attrVectorBucketArn));
  const indexName = 'catalog';
  const index = new s3vectors.CfnIndex(stack, 'CatalogIndex', {
    vectorBucketArn: vectorBucket.attrVectorBucketArn, // GetAtt: the index depends on the bucket
    indexName,
    dataType: 'float32',
    dimension: embeddingDimension, // the embedding model's output, as for the graph's index
    distanceMetric: 'cosine', // Nova embeddings are normalised
    // Read on every hit, never filtered on (filterable metadata is capped at 2 KB per vector);
    // the product's name and its page text (payoff.index_catalog).
    metadataConfiguration: { nonFilterableMetadataKeys: ['name', 'text'] },
  });
  // Deleted with the stack: deleting the index removes its vectors, and the bucket (which can
  // only be deleted empty) goes after its only index because the index depends on it.
  vectorBucket.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
  index.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
  return { index, bucketName, indexName };
}

// ------------------------------------------------------------------ the lakehouse (tab 6, trends, method 2)

interface Lakehouse {
  readonly bucket: s3tables.CfnTableBucket;
  readonly tables: s3tables.CfnTable[];
}

function addLakehouse(stack: cdk.Stack, repoRoot: string, suffix: string): Lakehouse {
  // Method 2 exports the graph to two Apache Iceberg tables (backend/src/ontology_rag/
  // lake_tables.json, read here too) in an S3 table bucket of this stack, and a data agent queries
  // them through the S3 Tables MCP server (the S3 Tables Iceberg REST endpoint, with no Glue Data
  // Catalog integration, nothing account-wide). Table bucket names are unique per account and
  // Region: the stack id's first block keeps two stacks apart. The tables are created here so that
  // deleting the stack empties the bucket before it deletes it.
  const lakeSpec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'backend', 'src', 'ontology_rag', 'lake_tables.json'), 'utf8'));
  const tableBucket = new s3tables.CfnTableBucket(stack, 'TableBucket', {
    tableBucketName: cdk.Fn.join('-', ['multimodal-ai-knowledge-graph', suffix]),
  });
  const tableNamespace = new s3tables.CfnNamespace(stack, 'TableNamespace', {
    tableBucketArn: tableBucket.attrTableBucketArn,
    namespace: lakeSpec.namespace,
  });
  const tables = Object.entries(lakeSpec.tables as Record<string, { fields: { name: string; type: string; required?: boolean }[] }>).map(
    ([name, spec]) => {
      const table = new s3tables.CfnTable(stack, `Table${name.replace(/(^|_)(\w)/g, (_m, _s, c: string) => c.toUpperCase())}`, {
        tableBucketArn: tableBucket.attrTableBucketArn,
        namespace: lakeSpec.namespace,
        tableName: name,
        openTableFormat: 'ICEBERG',
        icebergMetadata: {
          icebergSchema: {
            schemaFieldList: spec.fields.map((f) => ({ name: f.name, type: f.type, required: !!f.required })),
          },
        },
      });
      table.node.addDependency(tableNamespace);
      table.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
      return table;
    },
  );
  tableNamespace.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
  tableBucket.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
  return { bucket: tableBucket, tables };
}

// ------------------------------------------------------------------ Lambda code, environment, policies

/** What the API, the pipeline and the loader functions share. */
interface FunctionDefaults {
  readonly runtime: lambda.Runtime;
  readonly code: lambda.Code;
  readonly environment: Record<string, string>;
  /** Read, write and delete through openCypher, and the graph summary, on the one graph: the pipeline and the loader. */
  readonly graphAccess: iam.PolicyStatement;
  /** Read through openCypher and the graph summary only: the API, unless allowWriteQueries is set. */
  readonly graphRead: iam.PolicyStatement;
  /** InvokeModel on the vision, answer and embedding models (models.ts). */
  readonly bedrockAccess: iam.PolicyStatement;
  /** The VPC's private subnets and the Callers group: where the functions that call the graph run. */
  readonly network: Pick<lambda.FunctionProps, 'vpc' | 'vpcSubnets' | 'securityGroups'>;
  /** What Lambda needs on the execution role to manage a VPC function's network interfaces (managesNetworkInterfaces). */
  readonly networkAccess: iam.PolicyStatement[];
}

/**
 * The EC2 actions Lambda documents for the execution role of a function in a VPC: Lambda creates,
 * describes and deletes the function's network interfaces with them.
 */
const NETWORK_INTERFACE_ACTIONS = [
  'ec2:CreateNetworkInterface',
  'ec2:DescribeNetworkInterfaces',
  'ec2:DescribeSubnets',
  'ec2:DeleteNetworkInterface',
  'ec2:AssignPrivateIpAddresses',
  'ec2:UnassignPrivateIpAddresses',
];

function functionDefaults(
  stack: cdk.Stack,
  settings: Settings,
  graph: neptunegraph.CfnGraph,
  buckets: DataBuckets,
  guardrail: InputGuardrail,
  network: Network,
): FunctionDefaults {
  const code = bundledCode(settings.repoRoot);
  const environment: Record<string, string> = {
    GRAPH_BACKEND: 'neptune',
    GRAPH_ID: graph.attrGraphId,
    EMBEDDER: 'nova',
    EMBEDDING_MODEL_ID: settings.embeddingModelId,
    EMBEDDING_DIMENSION: String(settings.embeddingDimension),
    LLM_MODEL_ID: settings.llmModelId,
    ALLOW_WRITE_QUERIES: String(settings.allowWriteQueries),
    ONTOLOGIES_DIR: '/var/task/ontologies', // bundled fallback
    ONTOLOGIES_BUCKET: buckets.data.bucketName,
    ONTOLOGIES_PREFIX,
    ONTOLOGY_PATH: `/var/task/ontologies/${settings.defaultDomain}/${settings.defaultDomain}.ttl`,
    LOCAL_DATA_DIR: '/tmp',
    VISION_MODEL_IDS: settings.visionModelIds.join(','),
    ...guardrail.environment,
  };
  const graphAccess = new iam.PolicyStatement({
    actions: [
      'neptune-graph:ReadDataViaQuery',
      'neptune-graph:WriteDataViaQuery',
      'neptune-graph:DeleteDataViaQuery',
      'neptune-graph:GetGraphSummary',
      'neptune-graph:GetGraph',
    ],
    resources: [graph.attrGraphArn],
  });
  const graphRead = new iam.PolicyStatement({
    actions: ['neptune-graph:ReadDataViaQuery', 'neptune-graph:GetGraphSummary', 'neptune-graph:GetGraph'],
    resources: [graph.attrGraphArn],
  });
  // Bedrock: the vision, answer and embedding models by name (the inference profiles), and the
  // foundation models the profiles route to (models.ts).
  const modelIds = [...settings.visionModelIds, ...settings.answerModelIds, settings.embeddingModelId, settings.llmModelId];
  const bedrockAccess = new iam.PolicyStatement({
    actions: ['bedrock:InvokeModel'],
    resources: modelResources(stack, modelIds),
  });
  // aws-cdk-lib adds AWSLambdaVPCAccessExecutionRole only to a role it creates itself; these
  // functions bring their own (function-logging.ts), and that policy would also grant
  // logs:CreateLogGroup, CreateLogStream and PutLogEvents on every log group. So each role gets the
  // actions Lambda needs, and a deny of the same actions (and DetachNetworkInterface) for calls made
  // with the function's credentials from its own code: lambda:SourceFunctionArn is present only on
  // those, and each role serves one function. Lambda's own example denies by the function's ARN,
  // which a role's policy cannot name here: the function depends on that policy, so the reference
  // would be a dependency cycle.
  const networkAccess = [
    new iam.PolicyStatement({ actions: NETWORK_INTERFACE_ACTIONS, resources: ['*'] }),
    new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: [...NETWORK_INTERFACE_ACTIONS, 'ec2:DetachNetworkInterface'],
      resources: ['*'],
      conditions: { Null: { 'lambda:SourceFunctionArn': 'false' } },
    }),
  ];
  return {
    runtime: LAMBDA_RUNTIME,
    code,
    environment,
    graphAccess,
    graphRead,
    bedrockAccess,
    network: { vpc: network.vpc, vpcSubnets: { subnets: network.privateSubnets }, securityGroups: [network.callers] },
    networkAccess,
  };
}

/** cdk-nag: the one wildcard left in `bedrockAccess`. */
function invokesModels(fn: lambda.Function): void {
  acknowledgeWildcards(
    fn,
    'cross-Region and global inference profiles route to foundation models in other Regions: InvokeModel is authorized on the ' +
      'listed profiles and on the models they resolve to',
    wildcardResource(fn, foundationModels(cdk.Stack.of(fn))),
  );
}

/** A function in the VPC: `networkAccess` on its role, and cdk-nag's finding for the actions on '*'. */
function managesNetworkInterfaces(fn: lambda.Function, shared: FunctionDefaults): void {
  shared.networkAccess.forEach((statement) => fn.addToRolePolicy(statement));
  acknowledgeWildcards(
    fn,
    "Lambda creates and deletes the function's network interfaces with the execution role, in subnets and with " +
      'interface ids it picks at run time; the Describe actions accept only *, as in the AWS managed policy ' +
      'AWSLambdaVPCAccessExecutionRole. The deny next to it keeps the function code itself from these actions',
    'Resource::*',
  );
}

// ------------------------------------------------------------------ the two agents (agents.ts)

interface Agents {
  readonly query: QueryAgent;
  readonly lake: LakeAgent;
}

function addAgents(
  stack: cdk.Stack,
  settings: Settings,
  graph: neptunegraph.CfnGraph,
  lake: Lakehouse,
  guardrail: InputGuardrail,
  network: Network,
): Agents {
  // Both runtimes run in VPC mode in the private subnets with the Callers group, as the functions
  // do, and are created once the VPC has egress (a new VPC-mode runtime fetches its code zip
  // through the VPC; the Runtime construct adds no dependency on the network).
  const agentNetwork = agentcore.RuntimeNetworkConfiguration.usingVpc(stack, {
    vpc: network.vpc,
    vpcSubnets: { subnets: network.privateSubnets },
    securityGroups: [network.callers],
  });
  // The query agent (tab 2) runs on Amazon Bedrock AgentCore Runtime: the API (and, for the trends
  // question's graph agent job, the pipeline function: addTrendJobs) calls InvokeAgentRuntime on it
  // and nothing else; the agent's execution role, not theirs, is what the Neptune MCP server runs
  // with (read the graph, call the answer models).
  const query = new QueryAgent(stack, 'QueryAgent', {
    code: agentCodeAsset(stack, settings.repoRoot),
    graphId: graph.attrGraphId,
    graphArn: graph.attrGraphArn,
    llmModelId: settings.llmModelId,
    answerModelIds: settings.answerModelIds,
    platformVersion: settings.agentPlatformVersion,
    tracing: settings.agentTracing,
    guardrail,
    network: agentNetwork,
    egressReady: network.egressReady,
  });
  // Tab 6's trends question, method 2: the lake agent writes and queries the Iceberg tables; the API reads the
  // graph, sends it the rows, starts and polls its jobs, and may only see when the two tables
  // were last written (GetTable, addApi).
  const lakeAgent = new LakeAgent(stack, 'LakeAgent', {
    code: agentCodeAsset(stack, settings.repoRoot, 'lake'),
    tableBucketArn: lake.bucket.attrTableBucketArn,
    tableArns: lake.tables.map((t) => t.attrTableArn),
    llmModelId: settings.llmModelId,
    answerModelIds: settings.answerModelIds,
    platformVersion: settings.agentPlatformVersion,
    tracing: settings.agentTracing,
    network: agentNetwork,
    egressReady: network.egressReady,
  });
  lake.tables.forEach((t) => lakeAgent.node.addDependency(t));
  return { query, lake: lakeAgent };
}

// ------------------------------------------------------------------ API function + URL

interface Api {
  readonly fn: lambda.Function;
}

function addApi(
  stack: cdk.Stack,
  settings: Settings,
  shared: FunctionDefaults,
  buckets: DataBuckets,
  vectors: VectorIndex,
  lake: Lakehouse,
  agents: Agents,
): Api {
  const api = new lambda.Function(stack, 'ApiFunction', {
    ...functionLogging(stack, 'Api'),
    ...shared.network,
    runtime: shared.runtime,
    code: shared.code,
    handler: 'ontology_rag.lambda_handler.api_handler',
    memorySize: 1024,
    timeout: cdk.Duration.seconds(API_FUNCTION_TIMEOUT_S), // the browser's limit (API_FUNCTION_TIMEOUT_S)
    // No reserved concurrency: one page asks for many photos at once (ten thumbnails, the looks of
    // a search), and a cap of 10 answered some of them 429. The account's pool is the limit.
    environment: shared.environment,
    description: 'multimodal-ai-knowledge-graph HTTP API (GraphRAG on Neptune Analytics + Bedrock)',
  });
  // The API only reads the graph: the pipeline and the loader write it with their own roles. The
  // console's keyword guard (graph/neptune.py) is a convenience; this role is the control. With
  // -c allowWriteQueries=true the console's write clauses and POST /api/admin/clear-graph need the
  // write and delete actions too.
  api.addToRolePolicy(settings.allowWriteQueries ? shared.graphAccess : shared.graphRead);
  api.addToRolePolicy(shared.bedrockAccess);
  managesNetworkInterfaces(api, shared);
  // The product catalog: the API only reads it (QueryVectors with returnMetadata also needs
  // GetVectors; GetIndex and ListVectors for tab 0's count and tab 6's lenses). The loader writes it
  // (addLoader); nothing deletes from it.
  api.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['s3vectors:QueryVectors', 's3vectors:GetVectors', 's3vectors:ListVectors', 's3vectors:GetIndex'],
      resources: [vectors.index.attrIndexArn],
    }),
  );
  buckets.data.grantRead(api);
  invokesModels(api);
  readsDataBucket(api, buckets.data);
  writesDataPrefix(
    api,
    buckets.data,
    'writes under the ingest pipeline prefixes only: a browser upload (uploads/<run>/<file>) and the run document (runs/<run>/run.json), ' +
      'both named at request time',
    'uploads/',
    'runs/',
  );
  // The catalog index and the answer models. Kept out of the shared environment so the pipeline
  // function, which never calls S3 Vectors, does not create a client for it.
  api.addEnvironment('VECTOR_BUCKET', vectors.bucketName);
  api.addEnvironment('CATALOG_INDEX', vectors.indexName);
  api.addEnvironment('ANSWER_MODEL_IDS', settings.answerModelIds.join(','));
  // The two agents (addAgents): the API invokes their runtimes and names them in its environment.
  agents.query.runtime.grantInvokeRuntime(api);
  api.addEnvironment('AGENT_RUNTIME_ARN', agents.query.runtime.agentRuntimeArn);
  agents.lake.runtime.grantInvokeRuntime(api);
  api.addEnvironment('LAKE_RUNTIME_ARN', agents.lake.runtime.agentRuntimeArn);
  api.addEnvironment('TABLE_BUCKET_ARN', lake.bucket.attrTableBucketArn);
  api.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['s3tables:GetTable'],
      resources: lake.tables.map((t) => t.attrTableArn),
    }),
  );
  acknowledgeWildcards(
    api,
    'InvokeAgentRuntime is authorized on a runtime and on its endpoints (<runtime ARN>/<endpoint>), as the Runtime construct\'s grantInvokeRuntime spells it',
    wildcardResource(api, `${agents.query.runtime.agentRuntimeArn}/*`),
    wildcardResource(api, `${agents.lake.runtime.agentRuntimeArn}/*`),
  );
  // With -c explorerLogs=true the architecture panel shows the log events of the request that was
  // just made: telemetry.py finds them by request id with FilterLogEvents, the one read action it
  // calls, on the function's own log group only. Off by default: no read grant, and the route says 404.
  api.addEnvironment('EXPLORER_LOGS', String(settings.explorerLogs));
  if (settings.explorerLogs) api.logGroup.grant(api, 'logs:FilterLogEvents');
  return { fn: api };
}

/**
 * The API's function URL, which the browser calls directly. AuthType AWS_IAM: Lambda accepts only
 * requests signed (SigV4) by a principal allowed to invoke the function, and the stack allows one,
 * the signed-in user's role of the identity pool (Auth.signedInRole). The function's code checks no
 * token. CORS lets the site's origin, and no other, read the responses; the preflight is answered
 * by Lambda without credentials. No cookies travel: the signature is in the request headers.
 */
function addApiUrl(api: lambda.Function, auth: Auth, siteUrl: string): lambda.FunctionUrl {
  const url = api.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.AWS_IAM,
    cors: {
      allowedOrigins: [siteUrl],
      allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
      allowedHeaders: ['accept', 'content-type', 'authorization', 'x-amz-date', 'x-amz-security-token', 'x-amz-content-sha256'],
      allowCredentials: false,
      maxAge: cdk.Duration.hours(1),
    },
  });
  // The two actions an AWS_IAM function URL needs (Lambda developer guide, "Control access to Lambda
  // function URLs"), each held to the URL: InvokeFunctionUrl only with IAM auth, InvokeFunction only
  // when the call comes through the URL.
  auth.signedInRole.addToPolicy(
    new iam.PolicyStatement({
      sid: 'CallTheApiFunctionUrl',
      actions: ['lambda:InvokeFunctionUrl'],
      resources: [api.functionArn],
      conditions: { StringEquals: { 'lambda:FunctionUrlAuthType': 'AWS_IAM' } },
    }),
  );
  auth.signedInRole.addToPolicy(
    new iam.PolicyStatement({
      sid: 'InvokeTheApiThroughItsUrl',
      actions: ['lambda:InvokeFunction'],
      resources: [api.functionArn],
      conditions: { Bool: { 'lambda:InvokedViaFunctionUrl': 'true' } },
    }),
  );
  return url;
}

// ------------------------------------------------------------------ ingest pipeline

interface IngestPipeline {
  readonly fn: lambda.Function;
  readonly stateMachine: sfn.StateMachine;
}

function addIngestPipeline(
  stack: cdk.Stack,
  repoRoot: string,
  shared: FunctionDefaults,
  buckets: DataBuckets,
  api: lambda.Function,
): IngestPipeline {
  // Step Functions runs the batch: a Map over the sources (a few at a time) that invokes the
  // pipeline function twice per source (classify with Bedrock and validate against the ontology,
  // then MERGE into the graph), then once more for the summary. The definition is the JSON file the
  // web app shows in its "How this works" panel, inlined into the template. Retries with backoff
  // live in the definition, not in code.
  const pipelineFn = new lambda.Function(stack, 'PipelineFunction', {
    ...functionLogging(stack, 'Pipeline'),
    ...shared.network,
    runtime: shared.runtime,
    code: shared.code,
    handler: 'ontology_rag.lambda_handler.pipeline_handler',
    memorySize: 1024,
    timeout: cdk.Duration.seconds(PIPELINE_FUNCTION_TIMEOUT_S), // an ingest step, or the trends graph agent's job
    // A cost ceiling for a demo: the Map state runs 4 sources at a time (pipeline.asl.json), so one
    // run never needs more than 4 invocations plus the summary. A second concurrent run is throttled
    // (429), which the state machine retries with backoff instead of failing the source.
    reservedConcurrentExecutions: 5,
    environment: shared.environment,
    description: 'multimodal-ai-knowledge-graph ingest pipeline steps: classify · ingest · summarize (invoked by Step Functions), and the trends tab\'s jobs (invoked by the API)',
  });
  pipelineFn.addToRolePolicy(shared.graphAccess);
  pipelineFn.addToRolePolicy(shared.bedrockAccess);
  managesNetworkInterfaces(pipelineFn, shared);
  buckets.data.grantRead(pipelineFn); // ontologies + example sources + uploads
  buckets.data.grantPut(pipelineFn, 'runs/*'); // one record per source, the summary
  invokesModels(pipelineFn);
  readsDataBucket(pipelineFn, buckets.data);
  writesDataPrefix(
    pipelineFn,
    buckets.data,
    'writes one record per source and the summary under runs/<run>/',
    'runs/',
  );

  // The state machine's role. Step Functions may assume it only for a state machine of this
  // account in this Region (aws:SourceAccount and aws:SourceArn, the confused-deputy guard the
  // AgentCore roles carry too). The ARN ends in a wildcard: naming the state machine itself would
  // make the role depend on the state machine, which already depends on the role.
  const role = new iam.Role(stack, 'IngestPipelineRole', {
    assumedBy: new iam.ServicePrincipal('states.amazonaws.com').withConditions({
      StringEquals: { 'aws:SourceAccount': stack.account },
      ArnLike: {
        'aws:SourceArn': stack.formatArn({
          service: 'states',
          resource: 'stateMachine',
          resourceName: '*',
          arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
        }),
      },
    }),
  });
  const aslPath = path.join(repoRoot, 'backend', 'src', 'ontology_rag', 'pipeline.asl.json');
  const stateMachine = new sfn.StateMachine(stack, 'IngestPipeline', {
    role,
    definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(aslPath, 'utf8')),
    // The definition names the Lambda integration with the stack's partition, like every other ARN.
    definitionSubstitutions: { PipelineFunctionArn: pipelineFn.functionArn, Partition: cdk.Aws.PARTITION },
    timeout: cdk.Duration.minutes(30),
    comment: 'multimodal-ai-knowledge-graph: classify sources against the ontology and MERGE them into Neptune Analytics',
    // Every state transition, without the execution data: the run documents already live in S3.
    logs: {
      destination: new logs.LogGroup(stack, 'IngestPipelineLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      level: sfn.LogLevel.ALL,
      includeExecutionData: false,
    },
    tracingEnabled: true,
  });
  // The grants land on the role above: invoking the pipeline function here, log delivery and X-Ray
  // from the StateMachine construct (logs, tracingEnabled).
  pipelineFn.grantInvoke(stateMachine);
  acknowledgeWildcards(
    role,
    'invokes the pipeline function (and its versions, as grantInvoke spells it: <function ARN>:*); the CloudWatch Logs delivery ' +
      '(CreateLogDelivery, PutResourcePolicy, ...) and X-Ray APIs the state machine logs and traces with take no resource ARN',
    wildcardResource(stateMachine, `${pipelineFn.functionArn}:*`),
    'Resource::*',
  );

  // The API starts one execution per run (named after it) and polls DescribeExecution on it; the
  // records the steps wrote come from S3. Browser uploads go to uploads/<run>/ before the run starts.
  stateMachine.grantStartExecution(api);
  const executions = stack.formatArn({
    service: 'states',
    resource: 'execution',
    resourceName: `${stateMachine.stateMachineName}:*`,
    arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
  });
  api.addToRolePolicy(new iam.PolicyStatement({ actions: ['states:DescribeExecution'], resources: [executions] }));
  acknowledgeWildcards(
    api,
    'the API describes the executions it started, one per run id chosen at request time: every execution of this one state machine',
    wildcardResource(api, executions),
  );
  buckets.data.grantPut(api, 'uploads/*');
  buckets.data.grantPut(api, 'runs/*');
  api.addEnvironment('PIPELINE_STATE_MACHINE_ARN', stateMachine.stateMachineArn);
  api.addEnvironment('PIPELINE_FUNCTION_NAME', pipelineFn.functionName);
  return { fn: pipelineFn, stateMachine };
}

// ------------------------------------------------------------------ the trends question's agent job

/**
 * Method 1 of tab 6's trends question, "Ask the graph agent", runs as a background job in the
 * pipeline function, which the API invokes asynchronously (InvocationType Event, on the
 * unqualified function only: no version, no alias) after it wrote the job record
 * (jobs/trends/<id>.json); the function writes the progress and the result into the same record
 * and the browser polls the API for it (backend jobs.FunctionJobs). The query agent may work for
 * 300 s instead of the 70 s an API call leaves it: the pipeline function calls InvokeAgentRuntime on
 * the query agent's runtime (that one only, as the API does), with the model and reasoning effort
 * the job was started with (it checks the model against the answer model list), and waits for it
 * within its 360 s (PIPELINE_FUNCTION_TIMEOUT_S); the agent's execution role is unchanged.
 */
function addTrendJobs(stack: cdk.Stack, settings: Settings, buckets: DataBuckets, api: lambda.Function, pipelineFn: lambda.Function, agents: Agents): void {
  api.addToRolePolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [pipelineFn.functionArn] }));
  buckets.data.grantPut(api, `${TREND_JOBS_PREFIX}*`);
  buckets.data.grantPut(pipelineFn, `${TREND_JOBS_PREFIX}*`);
  for (const fn of [api, pipelineFn]) {
    writesDataPrefix(fn, buckets.data, "writes the records of the trends graph agent jobs, one per job id chosen at request time, under jobs/trends/", TREND_JOBS_PREFIX);
  }
  pipelineFn.addEnvironment('ANSWER_MODEL_IDS', settings.answerModelIds.join(','));
  agents.query.runtime.grantInvokeRuntime(pipelineFn);
  pipelineFn.addEnvironment('AGENT_RUNTIME_ARN', agents.query.runtime.agentRuntimeArn);
  acknowledgeWildcards(
    pipelineFn,
    "InvokeAgentRuntime is authorized on the query agent's runtime and on its endpoints (<runtime ARN>/<endpoint>), as the Runtime construct's grantInvokeRuntime spells it",
    wildcardResource(pipelineFn, `${agents.query.runtime.agentRuntimeArn}/*`),
  );
}

// ------------------------------------------------------------------ deploy-time graph load

/**
 * The modules that turn a data set into the graph and the catalog (service.py's
 * load_sample and _load_set, payoff.py's catalog indexing): GraphLoader's Version hashes them, so a
 * change to how data is loaded re-runs the load.
 */
const LOADING_CODE = ['loader', 'dna', 'ontology', 'owl', 'kg', 'service', 'payoff'].map((m) => `backend/src/ontology_rag/${m}.py`);

/** The first 16 hex characters of a SHA-256 over these files' names and bytes. */
function filesHash(files: string[]): string {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(path.basename(f));
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex').slice(0, 16);
}

function addLoader(
  stack: cdk.Stack,
  settings: Settings,
  shared: FunctionDefaults,
  buckets: DataBuckets,
  graph: neptunegraph.CfnGraph,
  vectors: VectorIndex,
  graphEndpoint: neptunegraph.CfnPrivateGraphEndpoint,
  network: Network,
): cdk.CfnResource {
  const loaderFn = new lambda.Function(stack, 'LoaderFunction', {
    ...functionLogging(stack, 'Loader'),
    ...shared.network,
    runtime: shared.runtime,
    code: shared.code,
    handler: 'ontology_rag.lambda_handler.loader_handler',
    memorySize: 1024,
    timeout: cdk.Duration.minutes(15),
    environment: shared.environment,
    description: 'multimodal-ai-knowledge-graph: loads the ontology and every data set of the graph\'s domain into the graph (CFN custom resource)',
  });
  loaderFn.addToRolePolicy(shared.graphAccess);
  loaderFn.addToRolePolicy(shared.bedrockAccess);
  managesNetworkInterfaces(loaderFn, shared);
  buckets.data.grantRead(loaderFn);
  invokesModels(loaderFn);
  readsDataBucket(loaderFn, buckets.data);
  // The product catalog: the loader writes each data set's products, the precomputed vectors of a
  // set's catalog.json (payoff.put_catalog_vectors) or the products of its items.json embedded at
  // deploy (payoff.index_catalog_items). PutVectors only, unless this deploy resets the graph: then
  // it also lists and deletes the index's vectors first (payoff.clear_catalog).
  loaderFn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: settings.resetGraph ? ['s3vectors:PutVectors', 's3vectors:ListVectors', 's3vectors:DeleteVectors'] : ['s3vectors:PutVectors'],
      resources: [vectors.index.attrIndexArn],
    }),
  );
  loaderFn.addEnvironment('VECTOR_BUCKET', vectors.bucketName);
  loaderFn.addEnvironment('CATALOG_INDEX', vectors.indexName);
  // The loader's copy of the data bucket's ontologies/ also takes the data sets' data files
  // (graph.json, vectors.json, catalog.json, items.json, ...). The API and the pipeline function
  // leave them out (S3Sync in backend ontologies.py), so a cold start never downloads them.
  loaderFn.addEnvironment('MIRROR_SAMPLE_DATA', 'true');
  const loader = new cdk.CfnResource(stack, 'GraphLoader', {
    type: 'Custom::GraphLoader',
    properties: {
      ServiceToken: loaderFn.functionArn,
      // -c resetGraph=true: empty the graph and the catalog index, then load (see StackProps).
      Reset: settings.resetGraph ? 'true' : 'false',
      WithEmbeddings: 'true',
      // Changing this value re-runs the (idempotent) load on the next deploy: the ontology (its
      // .ttl and the example manifests) and every data set of the domain (the .json files under
      // ontologies/<domain>/datasets/) are what the loader reads, and the code that loads them writes
      // the graph and the catalog, so adding or changing a set, or that code, re-runs it.
      Version: `${contentHash(path.join(settings.repoRoot, 'ontologies', settings.defaultDomain))}-${filesHash(LOADING_CODE.map((f) => path.join(settings.repoRoot, f)))}`,
    },
  });
  loader.addResourceDependency(graph);
  loader.addResourceDependency(vectors.index);
  // The load runs once the graph is reachable: through its private endpoint, with the S3 gateway
  // endpoint and the NAT gateway's routes in place for the data bucket, Bedrock and CloudFormation's
  // response URL.
  loader.addResourceDependency(graphEndpoint);
  loader.node.addDependency(network.egressReady);
  return loader;
}

// ------------------------------------------------------------------ web site + CDN

interface WebSite {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  /** `https://<distribution domain>`, no trailing slash. */
  readonly url: string;
}

function addWebSite(stack: cdk.Stack, logsBucket: s3.Bucket, managedLoginHost: string, frameAncestors: string[]): WebSite {
  const siteBucket = new s3.Bucket(stack, 'SiteBucket', {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    versioned: false,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    serverAccessLogsBucket: logsBucket,
    serverAccessLogsPrefix: 'site/',
  });

  // What the browser may load and where it may connect. The app bundles everything it renders
  // (scripts and styles from its own origin, images as data: and blob: URLs it builds itself) and
  // talks to its own origin (/config.json), to the pool's OpenID endpoints
  // (cognito-idp.<region>.amazonaws.com, the host web/src/auth.ts uses), to the managed-login host
  // (token endpoint, sign-out form), to the identity pool (cognito-identity.<region>.amazonaws.com,
  // the credentials) and to the API's function URL. The function URL is named by its Region's
  // pattern, *.lambda-url.<region>.on.aws, not by its exact host: the exact host would make the
  // distribution depend on the URL, whose CORS names the distribution's domain (a dependency cycle);
  // the URL's CORS stays exact. 'unsafe-inline' is for styles only: the graph view's
  // library (force-graph, under react-force-graph-2d, and its float-tooltip) appends <style>
  // elements to the page at run time. React's style props do not need it (React sets them through
  // the CSSOM, which CSP does not restrict), and hashes of the injected styles would change with
  // every library update. No page may frame the site unless the deployer names its origin
  // (-c frameAncestors=, for a slide deck that embeds the demo): then CSP frame-ancestors lists it
  // and X-Frame-Options, which cannot name an origin, is left out.
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' https://cognito-idp.${stack.region}.amazonaws.com https://${managedLoginHost} ` +
      `https://cognito-identity.${stack.region}.amazonaws.com https://*.lambda-url.${stack.region}.on.aws`,
    `frame-ancestors ${frameAncestors.length ? ["'self'", ...frameAncestors].join(' ') : "'none'"}`,
    "base-uri 'self'",
    `form-action 'self' https://${managedLoginHost}`,
    "object-src 'none'",
  ].join('; ');
  const securityHeaders = new cloudfront.ResponseHeadersPolicy(stack, 'SecurityHeaders', {
    comment: frameAncestors.length
      ? 'multimodal-ai-knowledge-graph: CSP (framing by the named origins), HSTS, no sniffing'
      : 'multimodal-ai-knowledge-graph: CSP, HSTS, no framing, no sniffing',
    securityHeadersBehavior: {
      contentSecurityPolicy: { contentSecurityPolicy, override: true },
      strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(730), includeSubdomains: true, override: true },
      contentTypeOptions: { override: true },
      ...(frameAncestors.length ? {} : { frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true } }),
      referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
    },
    // The app uses no camera, microphone or location (web/src calls none of those browser APIs), so
    // the browser refuses them to the site and to anything that runs in it.
    customHeadersBehavior: {
      customHeaders: [{ header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()', override: true }],
    },
  });
  const distribution = new cloudfront.Distribution(stack, 'Distribution', {
    comment: 'multimodal-ai-knowledge-graph demo',
    defaultRootObject: 'index.html',
    priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    enableLogging: true,
    logBucket: logsBucket,
    logFilePrefix: 'cloudfront/',
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      responseHeadersPolicy: securityHeaders,
    },
    // No custom error responses: the app has no client-side routes to rescue, and a missing file
    // should stay a 403 or 404.
  });
  cdk.Validations.of(distribution).acknowledge(
    { id: 'AwsSolutions-CFR1', reason: 'a demo for whoever holds the sign-in; no geographic restriction is required' },
    {
      id: 'AwsSolutions-CFR2',
      reason: 'AWS WAF is out of scope for this sample: the distribution serves the static site only, the API accepts only IAM-signed requests; a web ACL is the deployer\'s to add for anything beyond a demo',
    },
    {
      id: 'AwsSolutions-CFR4',
      reason:
        'with the default *.cloudfront.net certificate CloudFront fixes the viewer TLS minimum and does not let the distribution raise it; ' +
        'a custom domain with an ACM certificate and TLSv1.2_2021 is the deployer\'s',
    },
  );
  return { bucket: siteBucket, distribution, url: `https://${distribution.distributionDomainName}` };
}

// ------------------------------------------------------------------ the site and the ontologies into their buckets

/**
 * The ontologies folder and the web build are CDK assets, copied in by aws-cdk-lib's
 * BucketDeployment. Returns the ontologies' deployment, which the graph loader waits for.
 */
function addDeploy(stack: cdk.Stack, repoRoot: string, buckets: DataBuckets, site: WebSite, config: Record<string, string>): s3deploy.BucketDeployment {
  // Both deployments run on one provider function (aws-cdk-lib creates it once per stack). It logs
  // to a group the stack owns, 30 days and deleted with the stack like the sample's own functions;
  // without one, Lambda creates /aws/lambda/<name>, which never expires and outlives `cdk destroy`.
  const deployLogs = new logs.LogGroup(stack, 'DeployLogs', {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
  // Ontologies: the repo folder minus the build scripts, pruned so removed files disappear too.
  // It carries the data sets whole (ontologies/<domain>/datasets/<set>/): their data files, which
  // the graph loader reads, and their photos (media/<sub>/ of a set: look photos, product
  // shots), which the API serves by key. The Lambda zip leaves both out (copyOntologies).
  // Both sources are zipped into the CDK assets bucket, where the agent zips are too.
  const ontologiesZip = new s3_assets.Asset(stack, 'OntologiesSource', {
    path: path.join(repoRoot, 'ontologies'),
    exclude: ['**/*.py', '**/__pycache__', '**/__pycache__/**'],
  });
  const ontologiesDeploy = new s3deploy.BucketDeployment(stack, 'OntologiesDeploy', {
    sources: [s3deploy.Source.bucket(ontologiesZip.bucket, ontologiesZip.s3ObjectKey)],
    destinationBucket: buckets.data,
    destinationKeyPrefix: ONTOLOGIES_PREFIX,
    prune: true,
    logGroup: deployLogs,
  });
  const dist = path.join(repoRoot, 'web', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    cdk.Annotations.of(stack).addWarning(
      `web/dist not found (${dist}); run "npm run build" in web/ before deploying so the site is published.`,
    );
  } else {
    const siteZip = new s3_assets.Asset(stack, 'SiteSource', { path: dist });
    // The site and its /config.json (webConfig), one deployment so pruning keeps both.
    new s3deploy.BucketDeployment(stack, 'SiteDeploy', {
      sources: [s3deploy.Source.bucket(siteZip.bucket, siteZip.s3ObjectKey), s3deploy.Source.jsonData('config.json', config)],
      destinationBucket: site.bucket,
      distribution: site.distribution,
      distributionPaths: ['/*'],
      logGroup: deployLogs,
    });
  }
  acknowledgeBucketDeploymentProvider(stack, ontologiesZip.bucket, [buckets.data, site.bucket]);
  deleteLogGroupAfterRole(bucketDeploymentProvider(stack), deployLogs);
  return ontologiesDeploy;
}

/** The function aws-cdk-lib's BucketDeployment creates once per stack, under `Custom::CDKBucketDeployment<uuid>`. */
function bucketDeploymentProvider(stack: cdk.Stack): IConstruct {
  return stack.node.children.find((c) => c.node.id.startsWith('Custom::CDKBucketDeployment'))!;
}

/**
 * On `cdk destroy`, delete the provider's log group only after its role. The provider runs once more
 * during the delete, Lambda sends those log lines seconds later, and the role's basic execution
 * policy may create log groups: when the group goes first, the late lines create it again and it
 * outlives the stack.
 */
function deleteLogGroupAfterRole(provider: IConstruct, logGroup: logs.LogGroup): void {
  provider.node.findChild('ServiceRole').node.addDependency(logGroup);
}

/**
 * cdk-nag on the function aws-cdk-lib's BucketDeployment creates (one per stack, under
 * `Custom::CDKBucketDeployment<uuid>`): its runtime, role and policy are the construct's, not the
 * sample's. It reads the CDK assets bucket, writes and prunes the destination buckets and
 * invalidates the distribution.
 */
function acknowledgeBucketDeploymentProvider(stack: cdk.Stack, sources: s3.IBucket, destinations: s3.Bucket[]): void {
  const provider = bucketDeploymentProvider(stack);
  cdk.Validations.of(provider).acknowledge(
    {
      id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
      reason: "the BucketDeployment provider's role is created by aws-cdk-lib with AWS's basic execution policy (it logs to the stack's DeployLogs group)",
    },
    { id: 'AwsSolutions-L1', reason: 'the runtime of the BucketDeployment provider function is chosen by aws-cdk-lib, not by the sample' },
  );
  acknowledgeWildcards(
    provider,
    "aws-cdk-lib's BucketDeployment provider: reads the zipped sources from the CDK assets bucket, writes and prunes the site and the " +
      "ontologies bucket (grantReadWrite + delete on whole buckets) and invalidates the distribution (aws-cdk-lib's BucketDeployment " +
      "grants CreateInvalidation and GetInvalidation on '*')",
    wildcardAction('s3:GetObject*'),
    wildcardAction('s3:GetBucket*'),
    wildcardAction('s3:List*'),
    wildcardAction('s3:DeleteObject*'),
    wildcardAction('s3:Abort*'),
    'Resource::*',
    wildcardResource(provider, sources.arnForObjects('*')),
    ...destinations.map((b) => wildcardResource(provider, b.arnForObjects('*'))),
  );
}

// ------------------------------------------------------------------ sign-in (Amazon Cognito)

function addSignIn(stack: cdk.Stack, siteUrl: string, suffix: string, shared: FunctionDefaults): Auth {
  // One user pool, one user, managed login, one identity pool (auth.ts). Sample deployers pass their
  // own address: `cdk deploy --parameters SignInEmail=me@example.com`; the password is read from
  // Secrets Manager.
  const signInUser = new cdk.CfnParameter(stack, 'SignInUser', {
    type: 'String',
    default: 'participant',
    description: 'Username of the one user who may sign in to the demo.',
  });
  const signInEmail = new cdk.CfnParameter(stack, 'SignInEmail', {
    type: 'String',
    default: 'participant@example.com',
    description: 'Email address of that user (verified at creation; used for account recovery).',
  });
  return new Auth(stack, 'Auth', {
    siteUrl,
    stackSuffix: suffix,
    signInUser: signInUser.valueAsString,
    signInEmail: signInEmail.valueAsString,
    code: shared.code,
    runtime: shared.runtime,
  });
}

/**
 * What the web app reads first, from /config.json on its own origin (web/src/config.ts): where to
 * sign in, which identity pool gives it credentials, and the API's function URL. Written into the
 * site bucket at deploy time, so no id is in the code or the bundle.
 */
function webConfig(stack: cdk.Stack, auth: Auth, apiUrl: lambda.FunctionUrl): Record<string, string> {
  return {
    region: stack.region,
    userPoolId: auth.userPool.userPoolId,
    clientId: auth.client.userPoolClientId,
    domain: auth.domainHost,
    identityPoolId: auth.identityPool.ref,
    // https://<id>.lambda-url.<region>.on.aws, without the URL's trailing slash.
    apiUrl: cdk.Fn.join('', ['https://', cdk.Fn.select(2, cdk.Fn.split('/', apiUrl.url))]),
  };
}

// ------------------------------------------------------------------ outputs

interface Outputs {
  readonly graph: neptunegraph.CfnGraph;
  readonly network: Network;
  readonly buckets: DataBuckets;
  readonly vectors: VectorIndex;
  readonly agents: Agents;
  readonly api: Api;
  readonly apiUrl: lambda.FunctionUrl;
  readonly pipeline: IngestPipeline;
  readonly site: WebSite;
  readonly embeddingDimension: number;
}

function addOutputs(stack: cdk.Stack, parts: Outputs): void {
  new cdk.CfnOutput(stack, 'GraphId', { value: parts.graph.attrGraphId });
  new cdk.CfnOutput(stack, 'GraphEndpoint', { value: parts.graph.attrEndpoint });
  new cdk.CfnOutput(stack, 'VpcId', { value: parts.network.vpc.vpcId });
  new cdk.CfnOutput(stack, 'SiteUrl', { value: parts.site.url });
  new cdk.CfnOutput(stack, 'ApiUrl', { value: parts.apiUrl.url, description: 'The API function URL (IAM-signed requests only)' });
  new cdk.CfnOutput(stack, 'ApiFunctionName', { value: parts.api.fn.functionName });
  new cdk.CfnOutput(stack, 'ApiLogGroup', { value: parts.api.fn.logGroup.logGroupName });
  new cdk.CfnOutput(stack, 'OntologiesLocation', { value: `s3://${parts.buckets.data.bucketName}/${ONTOLOGIES_PREFIX}` });
  new cdk.CfnOutput(stack, 'IngestPipelineArn', { value: parts.pipeline.stateMachine.stateMachineArn });
  new cdk.CfnOutput(stack, 'PipelineFunctionName', { value: parts.pipeline.fn.functionName });
  new cdk.CfnOutput(stack, 'EmbeddingDimension', { value: String(parts.embeddingDimension) });
  new cdk.CfnOutput(stack, 'VectorBucketName', { value: parts.vectors.bucketName });
  new cdk.CfnOutput(stack, 'CatalogIndexArn', { value: parts.vectors.index.attrIndexArn });
  new cdk.CfnOutput(stack, 'AgentRuntimeArn', { value: parts.agents.query.runtime.agentRuntimeArn });
  new cdk.CfnOutput(stack, 'AgentRuntimeRoleArn', { value: parts.agents.query.runtime.role.roleArn });
}
