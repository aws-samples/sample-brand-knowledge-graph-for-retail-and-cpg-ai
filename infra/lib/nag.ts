// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { AwsSolutionsChecks } from 'cdk-nag';
import { IConstruct } from 'constructs';

/**
 * What every deployable app of this sample gets (bin/app.ts, and the tests the same way): one tag
 * on every taggable resource of every stack, for cost allocation and cleanup checks, and cdk-nag's
 * AWS Solutions rules, so synthesis fails on any finding that is not acknowledged next to its resource.
 */
export function configureApp(app: cdk.App): void {
  cdk.Tags.of(app).add('project', 'multimodal-ai-knowledge-graph');
  cdk.Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
}

/**
 * cdk-nag (AwsSolutions pack) acknowledgments. cdk-nag 3 reports every IAM wildcard as its own
 * finding, `AwsSolutions-IAM5[Action::<action>]` or `AwsSolutions-IAM5[Resource::<arn>]`, and each
 * one is acknowledged on its own with evidence, on the construct whose policy carries it (the
 * acknowledgment covers the construct's children). A Lambda function's statements are in its
 * role's policy, and the role is the function's sibling (function-logging.ts), not its child.
 */
export function acknowledgeWildcards(scope: IConstruct, reason: string, ...findings: string[]): void {
  const policyOwner = scope instanceof lambda.Function ? scope.role! : scope;
  cdk.Validations.of(policyOwner).acknowledge(...findings.map((finding) => ({ id: `AwsSolutions-IAM5[${finding}]`, reason })));
}

/** An action with a wildcard, as cdk-nag names it: `Action::s3:GetObject*`. */
export const wildcardAction = (action: string): string => `Action::${action}`;

/**
 * A resource ARN with a wildcard, as cdk-nag names it: intrinsic references are flattened to
 * `<LogicalId.Attribute>` / `<Ref>` and `${...}` substitutions to `<...>`, so the same source ARN
 * yields the same finding id whether the stack is bound to a Region (literals) or not (pseudo parameters).
 */
export function wildcardResource(scope: IConstruct, arn: string): string {
  return `Resource::${flatten(cdk.Stack.of(scope).resolve(arn))}`;
}

function flatten(node: unknown): string {
  if (typeof node === 'string') return node.replace(/\$\{/g, '<').replace(/\}/g, '>');
  const fn = node as Record<string, any>;
  if (fn['Fn::Join']) return (fn['Fn::Join'][1] as unknown[]).map(flatten).join(fn['Fn::Join'][0]);
  if (fn['Fn::Sub']) return flatten(fn['Fn::Sub']);
  if (fn['Fn::GetAtt']) return `<${fn['Fn::GetAtt'][0]}.${fn['Fn::GetAtt'][1]}>`;
  if (fn.Ref) return `<${fn.Ref}>`;
  return JSON.stringify(node);
}
