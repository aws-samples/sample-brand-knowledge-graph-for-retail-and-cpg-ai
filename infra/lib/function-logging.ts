// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * The log group and the execution role of one of the sample's Lambda functions: a log group the
 * stack owns (30 days, deleted with the stack) and a role that may write to it and nothing else.
 * The role a Function creates for itself carries AWSLambdaBasicExecutionRole, whose
 * logs:CreateLogGroup, CreateLogStream and PutLogEvents apply to every log group of the account;
 * the function's own group exists before the function, so it needs none of that.
 */
export function functionLogging(scope: Construct, id: string): { logGroup: logs.LogGroup; role: iam.Role } {
  const logGroup = new logs.LogGroup(scope, `${id}Logs`, {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
  const role = new iam.Role(scope, `${id}Role`, { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
  logGroup.grantWrite(role);
  return { logGroup, role };
}
