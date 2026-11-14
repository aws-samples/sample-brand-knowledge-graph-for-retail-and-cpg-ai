// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { list, stackProps } from '../lib/context';
import { MultimodalAiKnowledgeGraphStack } from '../lib/multimodal-ai-knowledge-graph-stack';

/** `cdk -c key=value ...`, as the CLI hands it to the app (every value a string). */
function appWith(context: Record<string, string>): cdk.App {
  return new cdk.App({ context: { ...context, 'aws:cdk:bundling-stacks': [] } });
}

describe('context.ts: what bin/app.ts reads from -c key=value', () => {
  test('-c visionModelIds=a,b -c defaultDomain=x -c allowWriteQueries=true reach the stack props and the template', () => {
    const app = appWith({ visionModelIds: 'a,b', defaultDomain: 'x', allowWriteQueries: 'true' });
    const props = stackProps(app);
    expect(props.visionModelIds).toEqual(['a', 'b']);
    expect(props.defaultDomain).toBe('x');
    expect(props.allowWriteQueries).toBe(true);
    const t = Template.fromStack(new MultimodalAiKnowledgeGraphStack(app, 'MultimodalAiKnowledgeGraph', props));
    t.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'ontology_rag.lambda_handler.api_handler',
      Environment: {
        Variables: Match.objectLike({
          VISION_MODEL_IDS: 'a,b',
          ANSWER_MODEL_IDS: 'a,b', // the answer models default to the vision list
          ONTOLOGY_PATH: '/var/task/ontologies/x/x.ttl',
          ALLOW_WRITE_QUERIES: 'true',
        }),
      },
    });
  });

  test('unset keys leave the stack defaults in place; the stack is bound to the deployer account and Region', () => {
    const props = stackProps(appWith({}));
    expect(props.graphMemory).toBe(16);
    expect(props.embeddingDimension).toBe(1024);
    for (const key of ['embeddingModelId', 'llmModelId', 'visionModelIds', 'answerModelIds', 'allowWriteQueries', 'defaultDomain', 'agentPlatformVersion', 'agentTracing', 'frameAncestors', 'vpcAzIds', 'synthesizer'] as const) {
      expect(props[key]).toBeUndefined();
    }
    expect(props.env).toEqual({ account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' });
  });

  test('numbers, flags and the platform version are parsed from the strings the CLI passes', () => {
    const props = stackProps(appWith({ graphMemory: '32', embeddingDimension: '384', allowWriteQueries: 'true', agentTracing: 'false', agentPlatformVersion: 'V1' }));
    expect(props.graphMemory).toBe(32);
    expect(props.embeddingDimension).toBe(384);
    expect(props.allowWriteQueries).toBe(true);
    expect(props.agentTracing).toBe(false);
    expect(props.agentPlatformVersion).toBe('V1');
    expect(() => stackProps(appWith({ agentPlatformVersion: 'V3' }))).toThrow(/agentPlatformVersion/);
    expect(stackProps(appWith({ frameAncestors: 'http://localhost:3030, http://127.0.0.1:3030' })).frameAncestors).toEqual([
      'http://localhost:3030',
      'http://127.0.0.1:3030',
    ]);
  });

  test('-c vpcAzIds= takes exactly two different AZ IDs and reaches the subnets', () => {
    const app = appWith({ vpcAzIds: 'use1-az4, use1-az6' });
    const props = stackProps(app);
    expect(props.vpcAzIds).toEqual(['use1-az4', 'use1-az6']);
    const t = Template.fromStack(new MultimodalAiKnowledgeGraphStack(app, 'MultimodalAiKnowledgeGraph', props));
    const zones = Object.values(t.findResources('AWS::EC2::Subnet')).map((s: any) => s.Properties.AvailabilityZoneId);
    expect(zones.sort()).toEqual(['use1-az4', 'use1-az6']);
    for (const bad of ['use1-az1', 'use1-az1,use1-az2,use1-az4', 'use1-az1,use1-az1', 'us-east-1a,us-east-1b', 'use1-az1,USE1-AZ2']) {
      expect(() => stackProps(appWith({ vpcAzIds: bad }))).toThrow(/vpcAzIds/);
    }
  });

  test('list(): comma-separated, trimmed, empty entries dropped, nothing when empty or unset', () => {
    expect(list(appWith({ answerModelIds: ' a , b,,c ' }), 'answerModelIds')).toEqual(['a', 'b', 'c']);
    expect(list(appWith({ answerModelIds: '' }), 'answerModelIds')).toBeUndefined();
    expect(list(appWith({}), 'answerModelIds')).toBeUndefined();
  });
});
