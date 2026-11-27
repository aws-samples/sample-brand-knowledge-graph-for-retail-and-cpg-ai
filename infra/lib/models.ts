// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';

/** Model ids that name an inference profile rather than a foundation model (cross-Region or global routing). */
const PROFILE_PREFIX = /^(global|us|eu|apac|jp|au|ca|us-gov)\./;

/** Every foundation model in every Region: what a cross-Region or global inference profile may route a request to. */
export function foundationModels(stack: cdk.Stack): string {
  return stack.formatArn({ service: 'bedrock', region: '*', account: '', resource: 'foundation-model', resourceName: '*' });
}

/**
 * Bedrock resources for `bedrock:InvokeModel` on these models: each listed inference profile of this
 * account in this Region (the caller always runs in the stack's Region), and the foundation models
 * because a profile routes the request to a model in another Region and InvokeModel is authorized on
 * both. Ids without a profile prefix are foundation models and need only the second resource.
 */
export function modelResources(stack: cdk.Stack, modelIds: string[]): string[] {
  const profiles = [...new Set(modelIds.filter((id) => PROFILE_PREFIX.test(id)))];
  return [
    foundationModels(stack),
    ...profiles.map((id) => stack.formatArn({ service: 'bedrock', resource: 'inference-profile', resourceName: id })),
  ];
}
