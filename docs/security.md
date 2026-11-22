# Security

The sample is a demo for one trusted user. This page lists what the deployed stack protects, the
guard at each trust boundary, and the residual risks it leaves to you. To report a vulnerability,
see [SECURITY.md](../SECURITY.md).

## Contents

* [What the stack protects](#what-the-stack-protects)
* [Trust boundaries](#trust-boundaries)
* [Residual risks](#residual-risks)

## What the stack protects

* your account's spend on Amazon Bedrock, Neptune Analytics, Lambda and Step Functions;
* the graph, the uploads and run records in the data bucket, the catalog index and the two Iceberg
  tables;
* the sign-in credential in Secrets Manager, and the tokens and temporary AWS credentials in the browser;
* the execution roles' permissions;
* the served site and the code zips;
* the logs.

## Trust boundaries

### Browser to CloudFront

The static site is public. It holds no secrets, and its `/config.json` (the user pool, the app
client, the managed-login domain, the identity pool and the API's URL, written at deploy time) is
public by design. CloudFront serves the site only: it has no route to the API. The site redirects to
HTTPS, and standard logs go to the logs bucket. There is no AWS WAF web ACL and no rate limit in
front of the distribution (see [Residual risks](#identity-and-access)).

### Response headers

A response headers policy sets a Content Security Policy, HSTS for two years,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a referrer policy and a
`Permissions-Policy` that turns off camera, microphone and geolocation. The CSP allows scripts and
styles from the site only, and connections to the site, the Cognito hosts and the Lambda function
URLs of the stack's Region. It names the function URL by the Region's pattern
(`https://*.lambda-url.<region>.on.aws`) and not by its host: the exact host would make the
distribution depend on the URL, whose CORS setting names the distribution. With
`-c frameAncestors=<origins>`, the CSP's `frame-ancestors` names those origins and the stack leaves
`X-Frame-Options` out.

### Sign-in

The browser signs in to the user pool with the authorization code flow and PKCE (`oidc-client-ts`).
The app client allows the SRP and refresh flows only, with no implicit grant and no client secret.
Callback and sign-out URLs are exact, user-existence errors are hidden and token revocation is on.
Access and ID tokens live one hour and the refresh token eight, in the tab's session storage.

### Who may call the API: IAM

The API is not public, and the sample's own code decides nothing about access. The browser calls
the API's Lambda function URL directly, and the URL's auth type is `AWS_IAM`: Lambda runs the
function only for a request signed (SigV4) by a principal that IAM allows to invoke it.

1. A Cognito identity pool exchanges the signed-in user's ID token for temporary AWS credentials of
   one role (`web/src/signing.ts`, the AWS SDK's `fromCognitoIdentityPool`). The pool has no guest
   identities and no classic flow, accepts only the stack's app client, and checks on the server
   that the token is not revoked.
2. Only `cognito-identity.amazonaws.com` may assume the role, only for this identity pool
   (`aud`) and only for signed-in identities (`amr`). The credentials last at most an hour and live
   in the tab's memory.
3. The role may call `lambda:InvokeFunctionUrl` (with `lambda:FunctionUrlAuthType` = `AWS_IAM`) and
   `lambda:InvokeFunction` (with `lambda:InvokedViaFunctionUrl` = `true`) on the API function, and
   nothing else.
4. The browser signs every request with the AWS SDK's `SignatureV4`, bodies included. A request
   without a valid signature of an allowed principal gets Lambda's `403 Forbidden` before the
   function runs.

The function URL's CORS setting lets the site's origin, and no other, read the answers. It allows
GET and POST with the signing headers and sends no cookies. A principal of your own account with an
identity policy that allows invoking the function can call it too, as for any IAM-protected
resource. The API's code holds no token library and checks no token.

The API does not tell users apart. An AgentCore runtime session id is the random UUID the browser
tab chose, and a trends job id is 128 random bits. Whoever can sign in can use any session or job
whose id they know (see [Residual risks](#identity-and-access)). The stack creates one user.

### Roles

Each of the sample's four Lambda functions (API, pipeline, loader, auth setup) has a role of its own
that writes to its own log group. Statements name their resources: the data bucket's prefixes, the
configured inference profiles, the state machine and the two runtimes. The roles
of the three functions in the VPC also allow the network interface actions Lambda needs for them.
Those actions take no resource ARN, and the roles deny them to calls from the function's own code.

`npx jest` in `infra/` runs cdk-nag's AWS Solutions rules on the stacks the app synthesizes. An
unacknowledged finding fails the tests and `cdk synth`, and every acknowledgment sits next to its
resource with a reason.

### The network

The graph's public connectivity is off. It answers only through its private graph endpoint, whose
security group accepts TCP 443 from the callers' security group and nothing else. The callers are
the API, pipeline and loader functions and both AgentCore runtimes. They run in the VPC's two
private subnets. The VPC has no public subnet, and the callers' network interfaces have no public IP
address.

The callers' security group has no inbound rule and allows outbound TCP 443 only. The callers reach
Amazon S3 through a gateway endpoint. They reach the other AWS APIs through a regional NAT gateway, whose two Elastic IPs are the only public addresses the stack
creates.

Nothing calls into the VPC. The browser invokes the API function through the Lambda service (its function URL), the API
invokes the agents through the AgentCore API, and Step Functions invokes the pipeline function
through the Lambda API. The VPC's default security group has no rules, and a flow log records
rejected traffic in a 30-day log group. The deploy-time functions that never call the graph (the
auth setup function and aws-cdk-lib's providers) run outside the VPC.

### Input checks and limits

Every openCypher statement is parameterized. Labels, edge types and ids are checked against their
shapes before a route runs. Each request is bounded: images up to 4 MB, 20 sources per run, texts up
to 20,000 characters, uploaded ontologies up to 1 MB, 10,000 characters of openCypher, `k` at most
20, and at most 100 ids per graph walk.

The pipeline function runs at most 5 concurrent executions. The API function has no reserved
concurrency, because one page loads many photos at once; it shares the account's Lambda
concurrency pool. Lambda answers 429 beyond either limit, and the web app shows it. An AWS SDK error reaches the browser as its error code
with a fixed phrase, or with every ARN redacted (`backend/src/ontology_rag/errors.py`). The full text
stays in the log.

### Query panel (tab 3)

The panel accepts read queries. It rejects write clauses unless `ALLOW_WRITE_QUERIES=true`
(`-c allowWriteQueries=true`), and without that setting the API's role cannot write the graph
either. It always rejects `CALL neptune.read()`, which would read S3 with the API's role.

### Query agent (tab 3)

The agent runs the Amazon Neptune MCP server, which executes any query it is sent. A guard
therefore refuses write clauses (`CREATE`, `MERGE`, `SET`, `DELETE`, `REMOVE`, `*.mutate`) before
they reach the server, whatever `ALLOW_WRITE_QUERIES` says. It also refuses `CALL neptune.read()`.

The agent and the server run on AgentCore Runtime with an execution role whose only graph
permission is `neptune-graph:ReadDataViaQuery`. The role may also call `bedrock:InvokeModel` on the
listed models and read the CDK bootstrap assets bucket, from which AgentCore Runtime loads the
agent's code zip. The runtime accepts IAM-signed calls only, and each session gets its own microVM.

### Agent sessions and rows

Each browser tab talks to the agent in a session of its own, named by a random UUID the tab
chose. Tool calls, output tokens and wall time are capped. Rows are truncated before
they reach the model and the browser, and the system prompt says that text inside the rows is never
an instruction.

### Lake agent (tab 6, trends method 2)

The S3 Tables MCP server runs read-only and offers the model one tool, `query_database`, reduced to
its SQL. The code fills in the table bucket, namespace and endpoint. A guard lets one read-only
`SELECT` through, with no table function that reads a file or URL, and the server checks again.

The runtime's role reaches the sample's table bucket, the listed models and the CDK bootstrap assets
bucket. On the table bucket it may read, and on its two tables it may also write
(`s3tables:PutTableData` and `s3tables:UpdateTableMetadataLocation`): the export commits a new
snapshot of each, and the agent's query tool itself stays read-only. It
never reaches the graph. The rows it writes come from the API and are checked against the schema
first.

### Models and the text they read

The answer prompt of tabs 4 and 5 and tab 6's describe prompts tell the model that the numbered
evidence is data and never an instruction. The two agents' prompts say the same for their rows.

Text a user uploads or sends to an agent sits inside tags: an ingested text in `<source_text>`, the
agents' requests in `<request>` and `<question>`. The tags tell the model where the input ends. They
are not a security control.

The ingest pipeline validates every model answer against the ontology. Only ontology classes and
values become nodes and edges; free text is limited to a label, a title and a statement's text.

Unicode tag characters (U+E0000 to U+E007F), which a model reads but a person does not see, and lone
surrogates (U+D800 to U+DFFF) are removed from every text sent to or read from a model. They are
also removed from an uploaded text, its title and its source before they are stored.

The prompts are public, in this repository and in the "How it works" panels. They hold no secret,
and the sample does not rely on keeping them hidden.

### Uploaded content and the parsers

Images are size-checked on their header and passed to Bedrock as bytes. No imaging library runs in
the API. Ontologies are parsed with rdflib from an allowlist of formats (Turtle, RDF/XML,
N-Triples, N3, JSON-LD). A JSON-LD document whose `@context` is a URL or carries `@import` is
refused, so the parser never fetches anything. RDF/XML uploads must be UTF-8 and must not declare a
DOCTYPE; both are checked before the parser runs, so entity expansion cannot start. A parser error
reaches the browser as one short line. JSON bodies are read with `json.loads` and must be objects.

### The data bucket and the API

The ontology folders, their `domain.json` and the manifests belong to the deployer. Folder ids and
file names are checked against their shapes and against the folder listing. Keys with `..`
segments are skipped when the bucket is mirrored.

`GET /api/graph/source` (the sources tree's preview) reads only the photo a graph node names: a
data set's photo, an example photo, or a tab 2 upload under `uploads/<run>/`, each key checked
against its shape. Node ids are checked against their shape, and the node must exist. A request
reads at most 8 photos and 3 MB. The route never reads run records or job records.

### Background jobs (tab 6)

The graph agent of the trends question can take longer than one API call may. The API therefore
writes a job record to `jobs/trends/<id>.json` in the data bucket (deleted after 1 day) and invokes
the pipeline function asynchronously. The API's role may invoke only that function, and the
pipeline function may call only the query agent's runtime. A job id is 128 random bits and is the
job's only handle: the record names no user (see [Who may call the API](#who-may-call-the-api-iam)).

### Tab 0 reports and changes nothing

`GET /api/setup` is the only setup route. It reads the stack's resources, with every ARN redacted,
and creates, starts or deletes nothing.

### The deployment zips

The three zips are built from requirement files pinned with hashes
(`backend/lambda-requirements.txt`, `backend/agentcore/requirements.txt`,
`backend/agentcore-lake/requirements.txt`). `make scan` audits them.

### Ingest pipeline

A run takes up to 20 sources, images up to 4 MB and texts up to 20,000 characters. Every run calls
Amazon Bedrock once per source and writes to the graph. Uploads land in the data bucket under
`uploads/<run>/` (deleted after 1 day) and run records under `runs/<run>/` (7 days).

### Logs

* One logs bucket with `cloudfront/`, `site/` and `data/` prefixes, kept 30 days.
* A Step Functions log group with every event and no execution data, plus X-Ray tracing.
* One 30-day log group per function, and one for the deploy-time copy of the site and the
  ontologies.

30 days is a demo choice; set the retention your organization requires. The two AgentCore runtimes
log to groups the service creates (`/aws/bedrock-agentcore/runtimes/<runtime id>-DEFAULT`). Those
have no retention and outlive `cdk destroy`. Set a retention on each:

```bash
aws logs put-retention-policy --log-group-name /aws/bedrock-agentcore/runtimes/<runtime id>-DEFAULT --retention-in-days 30
```

`GET /api/explorer/logs?request_id=` returns the API's own log events for one request of the last
15 minutes, unredacted. The architecture panel uses it. It is off by default (404, and the role gets
no log read): deploy with `-c explorerLogs=true` to turn it on, which sets `EXPLORER_LOGS=true` and
lets the role read only its own log group. The id must be the request's UUID. Every resource carries the tag
`project=multimodal-ai-knowledge-graph`.

### Logging in your account

AWS API calls are in the CloudTrail event history (management events, 90 days). For longer
retention, or for data-plane records of the graph, the vector index and the tables, create a trail
with data events in your account (billed per event). The runtimes' invocation, throttle and error
metrics are in CloudWatch (namespace `AWS/Bedrock-AgentCore`). CloudTrail records their
`InvokeAgentRuntime` calls only as data events.

The stack does not turn on Amazon Bedrock model invocation logging. That account and Region setting
records every prompt and response, uploaded texts and photos included. If your account already has
it on, this sample's prompts go to that destination. If you turn it on to investigate, keep a short
retention (for example 30 days) and encrypt the destination with a KMS key you control.

## Residual risks

These risks are accepted for a demo. Close each one before the site serves more than one trusted
user.

### Identity and access

* The stack creates one Cognito user whose password is generated into Secrets Manager. MFA with an
  authenticator app is optional; enforce it in the pool for anything beyond a demo. Add users only
  through the Cognito console.
* Every request after sign-in may call Amazon Bedrock. Each request is bounded, but the API function
  has no reserved concurrency, there is no per-user quota and no AWS WAF web ACL (a function URL
  cannot have one). Before you expose the site to more than one trusted user, put the API behind a
  service that takes a rate-based WAF rule, or cap the function's concurrency, and set Bedrock
  service quotas.
* The API does not tell signed-in users apart. Agent sessions and trends jobs are reached by their
  random ids alone, so a second user who learned one of your ids could use that session or read that
  job. With more than one user, bind them to the caller's identity in the request context
  (`requestContext.authorizer.iam.cognitoIdentity.identityId`).
* The user pool is on the Essentials plan, whose free tier covers the one user. The Plus plan's
  threat protection (compromised-credential and adaptive checks) is a small change in
  `infra/lib/auth.ts` (`featurePlan: PLUS` and a `standardThreatProtectionMode`). It costs about
  $0.02 per active user per month, with no free tier. The sample keeps Essentials because the
  password is a generated 24-character secret that a compromised-credential check would not find,
  and adaptive authentication could block sign-ins from a shared network such as an event venue's.
  Turn it on, in audit mode first, before you add users.
* The browser keeps the Cognito tokens in session storage for the tab, and the API credentials of the
  identity pool (at most an hour) in the tab's memory. Every tab's answers and
  inputs, with a photo you uploaded of up to about 1 MB in tab 1 and 750 KB in tab 5, stay there too
  until you sign out or close the tab. A production front end would keep the tokens in a
  backend-for-frontend cookie session.
* The CSP's `connect-src` allows every Lambda function URL in the stack's Region, by pattern (see
  [Response headers](#response-headers)). The API's own CORS setting names the site exactly.
* The API's role may only read the graph (`neptune-graph:ReadDataViaQuery`, `GetGraphSummary`,
  `GetGraph`). The ingest pipeline and the deploy-time loader write it with their own roles. The
  query panel's keyword guard (`graph/neptune.py`, which also reads backtick-quoted names) only
  turns a refused write into a clear message: the role is the control.
* With `-c allowWriteQueries=true`, the API's role also gets `WriteDataViaQuery` and
  `DeleteDataViaQuery`, the query panel accepts write clauses from whoever signs in, and
  `POST /api/admin/clear-graph` empties the graph (otherwise it answers 403). Set it only on a
  stack in an account of your own.
* The architecture panel is a teaching aid. It shows the signed-in user the stack's resources and
  the API's log lines for the request that was just made.

### Network and delivery

* With the default `*.cloudfront.net` certificate, the viewer TLS minimum cannot be raised. A custom
  domain with an ACM certificate gets `TLSv1.2_2021`. There is no geo restriction.
* The site refuses to be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) unless
  `-c frameAncestors=` names origins. Each named origin can then show the signed-in app inside its
  own page, so name only origins you control.
* The functions and agents in the VPC can reach any HTTPS host on the internet through the NAT
  gateway. Their security group allows outbound TCP 443 to every address, and nothing filters by
  domain name. Amazon Route 53 Resolver DNS Firewall or AWS Network Firewall would. The NAT gateway
  instead of interface endpoints is a choice for simplicity
  ([architecture.md](architecture.md#why-these-choices)).
* Four deploy-time functions run outside the VPC (Security Hub control Lambda.3): the sample's auth
  setup function and aws-cdk-lib's providers for the deploy-time copy, the bucket auto-delete and
  the default security group. None of them calls the graph.
* The VPC has no interface endpoint for Amazon EC2 (Security Hub control EC2.10). The sample makes
  no EC2 API calls from the VPC.

### Data and models

* Content you upload is stored in the data bucket and sent to the models you pick. Do not upload
  personal data or anything you may not share with a model provider under your Bedrock terms. If
  model invocation logging is on in your account, the prompts, uploads included, also go to its
  destination (see [Logging in your account](#logging-in-your-account)).
* Uploads are checked for size and declared format but not scanned for malware. The sample never
  runs them and has no imaging library in AWS. If you need a scan, Amazon GuardDuty Malware
  Protection for S3 can scan new objects in the data bucket.
* Text in uploaded sources reaches the models as evidence. The prompts tell the models to treat it as
  data, and the agents can only run read-only queries, but a crafted upload can still steer an
  answer. Treat the answers as demonstrations.
* The stack creates one Amazon Bedrock guardrail (`infra/lib/guardrail.ts`: content filters, prompt
  attacks, profanity; text only). The content filters check the typed text and the model's reply.
  The profanity word list checks only the typed text, because it also matches ordinary fashion
  terms that the model uses in a reply, such as "hobo bag". The app applies the guardrail per call,
  and only to the model calls that carry free-form input: a typed question, a text uploaded in
  tab 2, the rows of a query the participant wrote (tabs 4 and 6), and the query agent's question. Only that text is marked
  (`guardContent`, `backend/src/ontology_rag/guardrail.py`). The system prompts, the ontology, the
  app's own evidence and photos are not checked, and neither are the agents' tool results, so an
  instruction that reaches an agent through graph or table rows is not seen. The guardrail is not
  enforced on the account. A function without `GUARDRAIL_ID` (the tests; the stack always sets it)
  sends every call without it.
* Everything is encrypted at rest with keys AWS manages: the S3 buckets, S3 Vectors and S3 Tables
  with SSE-S3, Neptune Analytics and CloudWatch Logs with keys AWS owns, and the sign-in secret with
  the AWS managed key `aws/secretsmanager`. Customer managed KMS keys are a deployment choice; each
  store accepts one. A key for the site bucket must let CloudFront's origin access control decrypt
  in its key policy. The logs bucket must stay on SSE-S3, because S3 server access logging requires
  it.

### Operations

* Error text reaches the signed-in user. A failed pipeline source shows its error in tab 2,
  shortened to at most 300 characters, with ARNs replaced by `<arn>` and no stack trace. A rejected
  openCypher query shows Neptune's message with its ARNs redacted. The full text stays in the
  function's log.
* Nothing is backed up and no store has deletion protection. `cdk destroy` deletes what you
  ingested; take a Neptune Analytics snapshot first to keep a graph. It also leaves four log groups
  that never expire and the stack's VPC (see [deploy.md](deploy.md#cleanup)).
