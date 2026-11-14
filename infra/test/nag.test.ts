// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { AwsSolutionsChecks } from 'cdk-nag';
import { IConstruct } from 'constructs';
import { configureApp } from '../lib/nag';
import { MultimodalAiKnowledgeGraphStack } from '../lib/multimodal-ai-knowledge-graph-stack';

/**
 * cdk-nag's AWS Solutions rules on the stack the app synthesizes, exactly as bin/app.ts wires it
 * (configureApp). Every finding is either fixed or acknowledged next to its resource with a
 * reason; an unacknowledged one fails synthesis, and therefore `cdk synth`, `cdk deploy` and this test.
 */
const NO_BUNDLING = { 'aws:cdk:bundling-stacks': [] };
const ENV = { account: '111111111111', region: 'us-east-1' };

function app(): cdk.App {
  const a = new cdk.App({ context: { '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false, ...NO_BUNDLING } });
  configureApp(a);
  return a;
}

const stacks: Record<string, (a: cdk.App) => cdk.Stack> = {
  'MultimodalAiKnowledgeGraph (sample)': (a) => new MultimodalAiKnowledgeGraphStack(a, 'MultimodalAiKnowledgeGraph', { env: ENV }),
};

describe('cdk-nag (AwsSolutions)', () => {
  test('an unacknowledged finding fails synthesis, so cdk synth and cdk deploy stop on it', () => {
    const a = app();
    const stack = new cdk.Stack(a, 'Probe');
    new iam.Role(stack, 'Role', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') }).addToPolicy(
      new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: ['*'] }),
    );
    // what the deployer reads: the finding, the resource, and the id to acknowledge it with
    expect(() => a.synth()).toThrow(/Probe\/Role\/DefaultPolicy\/Resource[\s\S]*Acknowledge with 'AwsSolutions::AwsSolutions-IAM5\[Resource::\*\]'/);
    const report = new AwsSolutionsChecks().validateScope(stack);
    expect(report.violations.map((v) => v.ruleName)).toEqual(['AwsSolutions-IAM5[Resource::*]']);
  });

  for (const [name, build] of Object.entries(stacks)) {
    test(`${name}: synthesizes with zero unacknowledged findings`, () => {
      const a = app();
      const stack = build(a);
      expect(() => a.synth()).not.toThrow();
      // The same rules, run on the construct tree directly: the report lists what the plugin
      // would have printed, so a regression names the rule and the resource.
      const report = new AwsSolutionsChecks().validateScope(stack);
      const findings = report.violations.flatMap((v) => v.violatingResources.map((r) => `${v.ruleName} @ ${r.constructPath}`));
      expect(findings).toEqual([]);
    });
  }

  test('every acknowledgment names a specific AwsSolutions rule or finding and gives a reason', () => {
    const a = app();
    stacks['MultimodalAiKnowledgeGraph (sample)'](a);
    const acknowledged: Record<string, string>[] = [];
    const visit = (c: IConstruct) => {
      for (const entry of c.node.metadata) {
        if (entry.type === cdk.Validations.ACKNOWLEDGED_RULES_METADATA_KEY) acknowledged.push(entry.data as Record<string, string>);
      }
      c.node.children.forEach(visit);
    };
    visit(a);
    // (aws-cdk-lib acknowledges rules of its own CloudFormation-Validate plugin on some constructs; only ours are audited here)
    const ids = acknowledged.flatMap((d) => Object.keys(d)).filter((id) => id.includes('AwsSolutions-'));
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) {
      // never a bare `AwsSolutions-IAM5` (that would cover every wildcard of a construct at once)
      expect(id).toMatch(/^Annotation::AwsSolutions-(IAM[45]\[(Action|Resource|Policy)::.+\]|CFR[124]|COG[28]|SMG4|L1|S1)$/);
    }
    for (const reason of acknowledged.flatMap((d) => Object.entries(d)).filter(([id]) => id.includes('AwsSolutions-')).map(([, r]) => r)) {
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  test('the reasons state the facts they rest on: the Plus price, and where the invalidation wildcard comes from', () => {
    const a = app();
    stacks['MultimodalAiKnowledgeGraph (sample)'](a);
    const reasons: Record<string, string[]> = {};
    const visit = (c: IConstruct) => {
      for (const entry of c.node.metadata) {
        if (entry.type !== cdk.Validations.ACKNOWLEDGED_RULES_METADATA_KEY) continue;
        for (const [id, reason] of Object.entries(entry.data as Record<string, string>)) (reasons[id] ??= []).push(reason);
      }
      c.node.children.forEach(visit);
    };
    visit(a);
    // threat protection is a price question (Plus) and a workshop question (adaptive authentication), not "billed" vs "free"
    const cog8 = reasons['Annotation::AwsSolutions-COG8'];
    expect(cog8).toHaveLength(1);
    expect(cog8[0]).toContain('about $0.02 per active user per month');
    expect(cog8[0]).toContain('24-character');
    expect(cog8[0]).toContain('shared venue network');
    // CreateInvalidation does take a distribution ARN; the '*' is aws-cdk-lib's BucketDeployment grant
    const invalidation = reasons['Annotation::AwsSolutions-IAM5[Resource::*]'].filter((r) => r.includes('invalidates the distribution'));
    expect(invalidation).toHaveLength(1);
    expect(invalidation[0]).toContain("grants CreateInvalidation and GetInvalidation on '*'");
    expect(invalidation[0]).not.toContain('takes no resource ARN');
  });
});
