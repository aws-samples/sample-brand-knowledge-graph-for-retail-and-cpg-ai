#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { stackProps } from '../lib/context';
import { configureApp } from '../lib/nag';
import { MultimodalAiKnowledgeGraphStack } from '../lib/multimodal-ai-knowledge-graph-stack';

const app = new cdk.App();
configureApp(app); // the project tag and the cdk-nag checks

// The sample: `cdk deploy`; every `-c key=value` of context.ts overrides a default of the stack.
new MultimodalAiKnowledgeGraphStack(app, 'MultimodalAiKnowledgeGraph', {
  ...stackProps(app),
  description:
    'Multimodal AI knowledge graph sample: Amazon Neptune Analytics knowledge graph with a multimodal vector index, ' +
    'Amazon Bedrock (Nova embeddings + Claude), Lambda API and CloudFront-hosted demo UI.',
});

app.synth();
