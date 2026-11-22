// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { MultimodalAiKnowledgeGraphStackProps } from './multimodal-ai-knowledge-graph-stack';
import { checkAzIds } from './network';

/**
 * The stack props bin/app.ts builds from the CDK context: `cdk deploy -c key=value` on the command
 * line and the `context` block of cdk.json (the defaults of `graphMemory` and
 * `embeddingDimension`). A key that is not set leaves the stack's own default in place. Lists are
 * comma-separated (`-c visionModelIds=a,b`), flags are the word `true`.
 */

const PLATFORM_VERSIONS = ['V1', 'V2', 'auto'] as const;
type PlatformVersion = (typeof PLATFORM_VERSIONS)[number];

/** Everything the MultimodalAiKnowledgeGraph stack takes from the context, and the deployer's account and Region. */
export function stackProps(app: cdk.App): MultimodalAiKnowledgeGraphStackProps {
  return {
    graphMemory: num(app, 'graphMemory', 16),
    embeddingDimension: num(app, 'embeddingDimension', 1024),
    embeddingModelId: text(app, 'embeddingModelId'),
    llmModelId: text(app, 'llmModelId'),
    visionModelIds: list(app, 'visionModelIds'),
    answerModelIds: list(app, 'answerModelIds'),
    allowWriteQueries: flag(app, 'allowWriteQueries'),
    explorerLogs: flag(app, 'explorerLogs'),
    resetGraph: flag(app, 'resetGraph'),
    defaultDomain: text(app, 'defaultDomain'),
    agentPlatformVersion: platformVersion(app),
    agentTracing: flag(app, 'agentTracing'),
    frameAncestors: list(app, 'frameAncestors'),
    vpcAzIds: azIds(app),
    env: deployerEnv(),
  };
}

/** The account and Region of the deployer's credentials, as the CDK CLI passes them (us-east-1 without a configured Region). */
function deployerEnv(): cdk.Environment {
  return { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' };
}

/** A context value as a string (cdk.json may hold a number), or undefined when unset. */
function text(app: cdk.App, key: string): string | undefined {
  const value = app.node.tryGetContext(key);
  return value === undefined ? undefined : String(value);
}

function num(app: cdk.App, key: string, fallback: number): number {
  const value = text(app, key);
  return value === undefined ? fallback : Number(value);
}

/** A comma-separated list, trimmed, without empty entries: `-c visionModelIds=a, b` is `['a', 'b']`; an empty one counts as unset. */
export function list(app: cdk.App, key: string): string[] | undefined {
  const items = (text(app, key) ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

/** `true` for the word true, `false` for anything else that is set, undefined when unset (the stack decides). */
function flag(app: cdk.App, key: string): boolean | undefined {
  const value = text(app, key);
  return value === undefined ? undefined : value === 'true';
}

/** `-c vpcAzIds=use1-az1,use1-az2`: exactly two different AZ IDs (network.ts checkAzIds), undefined when unset. */
function azIds(app: cdk.App): string[] | undefined {
  const ids = list(app, 'vpcAzIds');
  return ids && checkAzIds(ids);
}

function platformVersion(app: cdk.App): PlatformVersion | undefined {
  const value = text(app, 'agentPlatformVersion');
  if (value !== undefined && !PLATFORM_VERSIONS.includes(value as PlatformVersion)) {
    throw new Error(`unknown agentPlatformVersion "${value}"; use -c agentPlatformVersion=V1, V2 or auto`);
  }
  return value as PlatformVersion | undefined;
}
