# Deploy, configure and clean up

This page has the detail behind the README's [Deploy](../README.md#deploy) and
[Clean up](../README.md#clean-up) sections: the permissions a narrow deployment role needs, every
setting, what the graph loader does, the sign-in, and what stays after `cdk destroy`.

## Contents

* [Permissions](#permissions)
* [What the deploy does](#what-the-deploy-does)
* [Configuration](#configuration)
* [Stack outputs](#stack-outputs)
* [Sign-in](#sign-in)
* [Troubleshooting](#troubleshooting)
* [Cleanup](#cleanup)

## Permissions

The default CDK bootstrap gives CloudFormation an execution role that covers everything the stack
creates. If your account uses a narrower execution role, it needs these services:

* Amazon EC2: the VPC, subnets, route tables, internet and NAT gateways, Elastic IPs, VPC
  endpoints, flow logs and security groups
* Amazon Neptune Analytics: the graph and its private graph endpoint
* Amazon S3, Amazon S3 Vectors and Amazon S3 Tables
* AWS Lambda and AWS Step Functions
* Amazon Bedrock AgentCore: the two runtimes
* Amazon CloudFront
* Amazon Cognito, AWS Secrets Manager and AWS Systems Manager Parameter Store
* Amazon Bedrock: the guardrail
* Amazon CloudWatch Logs
* AWS IAM: the execution roles, and `iam:CreateServiceLinkedRole` for
  `AWSServiceRoleForBedrockAgentCoreNetwork`, which AgentCore creates the first time a runtime uses
  VPC mode

## What the deploy does

`npx cdk deploy` builds the Lambda zip and the two agent zips at synth time and uploads about
250 MB of assets to the CDK bootstrap bucket: the Lambda zip (24 MB), the query agent (56 MB) and the
lake agent (170 MB). The deploy takes 25 to 35 minutes. The Neptune Analytics graph and the
CloudFront distribution take most of that time.

The `ontologies/` folder goes to the data bucket and `web/dist` to the site bucket. Then the
`GraphLoader` custom resource, a Lambda function in the VPC, loads the ontology and every data set
of the graph's domain into the graph. It also writes the sets' products into the catalog index in
Amazon S3 Vectors. For the two sets the sample ships, AnyCompany Apparel and one look of AnyCompany Fashion House, that is
about 105 Nova embeddings for the graph and one for each of their 62 products.

The loader needs Amazon Bedrock access to the embedding model. If it fails, it reports the reason and
the first deploy rolls back, graph included. Fix the cause and run `npx cdk deploy` again. The CDK
CLI removes the rolled-back stack first. The rollback keeps the stack's VPC, which
`make network-cleanup` removes later (see [Cleanup](#cleanup)).

A later deploy runs the loader again when a `.ttl` or `.json` file of the domain's folder changes,
or when the loading code changes (`loader.py`, `dna.py`, `ontology.py`, `owl.py`, `kg.py`,
`service.py` and `payoff.py` in `backend/src/ontology_rag/`). Adding or changing a data set
therefore loads it on the next deploy.

The loader never empties the graph (`Reset: 'false'`): a later deploy keeps what the graph holds,
including what tab 2 added, and MERGEs the data sets into it.

A second custom resource, `AuthSetup`, sets the generated sign-in password on the Cognito user.

## Configuration

Every setting is a `-c key=value` on `npx cdk deploy` and has a default. The keys are read in
`infra/lib/context.ts`.

| Key | Default | What it changes | Note |
|---|---|---|---|
| `graphMemory` | `16` | The graph's memory in m-NCU | Billed per m-NCU-hour |
| `embeddingDimension` | `1024` | The vector dimension of the graph and the catalog index | A change recreates the graph |
| `embeddingModelId` | `amazon.nova-2-multimodal-embeddings-v1:0` | The embedding model | Must produce `embeddingDimension` values |
| `llmModelId` | `global.anthropic.claude-sonnet-5-5` | The default answer and classification model | |
| `visionModelIds` | The list in `backend/src/ontology_rag/config.py` | The vision models tab 1 offers | Comma-separated |
| `answerModelIds` | The vision list | The answer models tabs 4 to 6 and the agents offer | Comma-separated |
| `defaultDomain` | `fashion` | The folder of `ontologies/` the graph is loaded with | Its changes re-run the loader |
| `allowWriteQueries` | `false` | Lets tab 3's query panel run write clauses and `POST /api/admin/clear-graph` empty the graph; gives the API's role the graph's write and delete actions | Only for an account where you work alone |
| `explorerLogs` | `false` | Lets the architecture panel show the API's log lines for the request just made (`EXPLORER_LOGS`) | The lines are not redacted: only where every signed-in user may read the API's logs |
| `agentPlatformVersion` | `auto` | The AgentCore Runtime platform version: `V1`, `V2` or `auto` | `auto` picks V2 where it exists |
| `agentTracing` | `false` | Sends the runtimes' traces to AWS X-Ray | Needs CloudWatch Transaction Search, an account-wide setting the stack leaves alone |
| `vpcAzIds` | The first two Availability Zone IDs AgentCore Runtime supports in the Region | The Availability Zone IDs of the two subnets, for example `use1-az1,use1-az2` | Set it on the first deploy only. A change replaces the subnets, so destroy the stack and deploy again instead. A Region missing from the table in `infra/lib/network.ts` needs the key |
| `frameAncestors` | none | Origins that may show the site in a frame, for example `http://localhost:3030` | See below |

With `frameAncestors` set, a slide deck can embed the demo. Framed, the app signs in through a
popup once, and every other frame of the same browser tab picks that sign-in up.
`?tab=explore|ingest|graph|ask|stylist|lenses` opens a tab directly. Name only origins you control:
the stack accepts `https` origins, and plain `http` only for `localhost` and `127.0.0.1`.

Two CloudFormation parameters set the sign-in user. `SignInEmail` is the user's email address
(default `participant@example.com`), used only for account recovery. `SignInUser` is the user name
(default `participant`); it must not look like an email address. The CDK CLI reuses both values on
later deploys.

## Stack outputs

`SiteUrl` (also `SignInUrl`), `ApiUrl`, `GraphId`, `GraphEndpoint`, `VpcId`, `OntologiesLocation`
(the S3 prefix the ontologies are read from), `IngestPipelineArn`, `PipelineFunctionName`,
`ApiFunctionName`, `ApiLogGroup`, `EmbeddingDimension`, `VectorBucketName`, `CatalogIndexArn`,
`AgentRuntimeArn`, `AgentRuntimeRoleArn`, `UserPoolId`, `IdentityPoolId`, `SignInUser`,
`SignInPasswordSecret`. `ApiUrl` is the API's Lambda function URL; it answers only requests signed
with the signed-in user's credentials.

## Sign-in

The stack creates a Cognito user pool with one user and no self sign-up.

* AWS Secrets Manager generates the password when the stack is created, and `AuthSetup` sets it on
  the user as a permanent password. It is not a stack output. Read it in the Secrets Manager
  console, or run
  `aws secretsmanager get-secret-value --secret-id <SignInPasswordSecret> --query SecretString --output text`.
* Open `SiteUrl`. The app sends the browser to the Cognito managed login page, and after sign-in
  you return to the site.
* The tokens are valid for one hour. The app renews them with the refresh token for up to eight
  hours. The identity pool's AWS credentials, which sign the API requests, also last an hour and are
  renewed the same way. *Sign out* in the header ends the session.
* MFA with an authenticator app is optional. You can add users in the Cognito console.

[security.md](security.md#who-may-call-the-api-iam) explains how IAM decides who may call the API.

## Troubleshooting

* **The first request after two idle weeks fails.** After 14 days without a call, Lambda reclaims
  the network interfaces of a function in a VPC and the function becomes inactive. The next request
  fails while Lambda creates them again. Retry after a few minutes.
* **A deploy fails with `VpcLimitExceeded`.** The Region already holds 5 VPCs, its default quota.
  The default VPC counts, and so does each VPC that an earlier destroy or a rolled-back deploy left.
  Run the network cleanup (see [Cleanup](#cleanup)), then deploy again.
* **The app keeps sending you back to the sign-in page.** The browser signs each API request with
  your computer's clock, and Lambda refuses a signature that is more than 5 minutes off. Set the
  clock to update automatically, then reload the page.
* **A deploy fails after several minutes in another Region.** The Region lacks one of the services
  or models the sample uses. See the README's [Prerequisites](../README.md#prerequisites).

## Cleanup

```bash
cd infra && npx cdk destroy
# up to 8 hours later, once AgentCore has released the agents' network interfaces in the VPC:
cd .. && make network-cleanup ARGS=--delete
```

`npx cdk destroy` removes everything billed per hour: the graph and its private endpoint, the NAT
gateway, the vector and table buckets, the logs bucket, the user pool and the secret.
CloudFormation waits while Lambda deletes the functions' network interfaces, which can take about
20 minutes. Nothing is backed up. Take a Neptune Analytics snapshot of the graph first if you want
to keep what you ingested; a snapshot is billed for its storage and stays after the stack is gone.

The stack keeps its VPC, because AgentCore keeps the agents' network interfaces in it for up to 8
hours after the delete. What it keeps has no hourly cost: the VPC with its two subnets, two route
tables and two security groups, and the flow log with its log group and role.

After those 8 hours, run `make network-cleanup ARGS=--delete`. It needs the backend venv from
`make setup` and uses your AWS credentials and `AWS_REGION` (default `us-east-1`).
`make network-cleanup ARGS="--delete --wait 540"` waits for the interfaces instead. Without `ARGS`
it only reports the VPCs the stack left and the network interfaces still in them. Until the
cleanup has run, the VPC counts against the Region's quota of 5.

These also remain after `cdk destroy`:

* The two log groups AgentCore creates for the runtimes,
  `/aws/bedrock-agentcore/runtimes/<runtime id>-DEFAULT`. The service owns them, so the stack
  cannot delete them.
* The log groups of two provider functions that aws-cdk-lib adds: the bucket auto-delete
  (`/aws/lambda/<stack>-CustomS3AutoDeleteObjects...`) and the default security group
  (`/aws/lambda/<stack>-CustomVpcRestrictDefault*`).
* The uploaded assets in the CDK bootstrap bucket, and the bootstrap stack itself.
* Amazon Bedrock model access.

The four log groups never expire unless you set a retention (see
[security.md](security.md#logs)). Delete them with
`aws logs delete-log-group --log-group-name <name>`.
