// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { configureApp } from '../lib/nag';
import { MultimodalAiKnowledgeGraphStack } from '../lib/multimodal-ai-knowledge-graph-stack';

/**
 * Every logical id of the template bin/app.ts synthesizes, as a snapshot. A logical id is
 * derived from the construct path, so moving a resource under another construct or renaming a
 * construct id makes CloudFormation replace the deployed resource on the next `cdk deploy`; for
 * the stateful ones (the graph, the buckets, the user pool, the tables) that is data loss. The
 * stack is therefore organised as section functions that keep the stack as their scope, and a
 * change to this list has to be deliberate: review the diff, then `npx jest -u`.
 */
const NO_BUNDLING = { 'aws:cdk:bundling-stacks': [] };
const ENV = { account: '111111111111', region: 'us-east-1' };

function app(): cdk.App {
  const a = new cdk.App({ context: { '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false, ...NO_BUNDLING } });
  configureApp(a);
  return a;
}

/** Parameters, conditions and outputs by id; resources by id with their type. */
function logicalIds(stack: cdk.Stack): Record<string, unknown> {
  const json = Template.fromStack(stack).toJSON();
  const keys = (section: string) => Object.keys(json[section] ?? {}).sort();
  const resources = Object.fromEntries(
    Object.entries(json.Resources as Record<string, { Type: string }>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, resource]) => [id, resource.Type]),
  );
  return { Parameters: keys('Parameters'), Conditions: keys('Conditions'), Resources: resources, Outputs: keys('Outputs') };
}

/**
 * A copy of the folders the stack reads, plus a placeholder site in web/dist. The stack adds the
 * site's deployment only when web/dist/index.html exists, and a fresh clone has none until the web
 * build runs (`make test` runs these tests first). With the placeholder the snapshot always shows
 * the template of a deploy, whatever was built locally.
 */
function deployRoot(): string {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logical-ids-'));
  for (const dir of ['ontologies', 'backend/src', 'backend/agentcore', 'backend/agentcore-lake']) {
    fs.cpSync(path.join(repoRoot, dir), path.join(root, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web', 'dist', 'index.html'), '<!doctype html>\n');
  return root;
}

describe('logical ids of the synthesized templates', () => {
  let root: string;
  beforeAll(() => {
    root = deployRoot();
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test('MultimodalAiKnowledgeGraph (sample)', () => {
    const stack = new MultimodalAiKnowledgeGraphStack(app(), 'MultimodalAiKnowledgeGraph', { env: ENV, repoRoot: root });
    expect(logicalIds(stack)).toMatchSnapshot();
  });
});
