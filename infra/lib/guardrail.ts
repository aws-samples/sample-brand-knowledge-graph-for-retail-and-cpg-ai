// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { createHash } from 'node:crypto';
import { acknowledgeWildcards, wildcardResource } from './nag';

/** What a blocked call returns in place of the model's reply (the app shows its own sentence: backend guardrail.py). */
export const BLOCKED_MESSAGE = 'Sorry, the model cannot answer this question.';

/** The content filters: what the guardrail blocks, on the text a participant types and on the model's reply. */
const FILTERS: bedrock.CfnGuardrail.ContentFilterConfigProperty[] = [
  { type: 'HATE', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
  { type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH' },
  { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
  { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
  { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
  // Prompt attacks are an input filter only (Bedrock rejects an output strength other than NONE).
  { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
].map((f) => ({
  ...f,
  inputModalities: ['TEXT'],
  ...(f.outputStrength === 'NONE' ? {} : { outputModalities: ['TEXT'] }),
  inputAction: 'BLOCK',
  ...(f.outputStrength === 'NONE' ? {} : { outputAction: 'BLOCK' }),
}));

/**
 * The guardrail profile of a Region's geography (cross-Region guardrail inference, which the
 * Standard tier of the content filters requires), or none: then the Classic tier, in-Region.
 */
export function guardrailProfile(region: string): string | undefined {
  if (cdk.Token.isUnresolved(region)) return undefined;
  const geo = [
    ['us-gov-', undefined],
    ['us-', 'us'],
    ['eu-', 'eu'],
    ['ap-', 'apac'],
  ].find(([prefix]) => region.startsWith(prefix as string));
  return geo?.[1] ? `${geo[1]}.guardrail.v1:0` : undefined;
}

/**
 * The Amazon Bedrock guardrail on free-form input (backend/src/ontology_rag/guardrail.py). It is
 * not enforced on the account: the app names it on the model calls that carry text a person
 * typed (the question, an uploaded text, the rows of their own query) and marks only that text,
 * so the system prompts, the ontology and the evidence are not checked, and calls with nothing
 * typed go without it. Photos are not checked (text filters only).
 */
export class InputGuardrail extends Construct {
  readonly guardrail: bedrock.CfnGuardrail;
  readonly version: bedrock.CfnGuardrailVersion;
  /** The guardrail profile id (`us.guardrail.v1:0`), when the Standard tier is used. */
  readonly profileId?: string;

  constructor(scope: Construct, id: string, props: { readonly name: string }) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    this.profileId = guardrailProfile(stack.region);
    const config = {
      blockedInputMessaging: BLOCKED_MESSAGE,
      blockedOutputsMessaging: BLOCKED_MESSAGE,
      contentPolicyConfig: {
        filtersConfig: FILTERS,
        contentFiltersTierConfig: { tierName: this.profileId ? 'STANDARD' : 'CLASSIC' },
      },
      // The profanity list checks only what a participant types. It also lists ordinary fashion terms
      // ("hobo bag" matches "hobo"), which the model uses in its replies; the content filters still
      // check the reply.
      wordPolicyConfig: { managedWordListsConfig: [{ type: 'PROFANITY', inputEnabled: true, inputAction: 'BLOCK', outputEnabled: false }] },
      ...(this.profileId
        ? { crossRegionConfig: { guardrailProfileArn: stack.formatArn({ service: 'bedrock', resource: 'guardrail-profile', resourceName: this.profileId }) } }
        : {}),
    };
    this.guardrail = new bedrock.CfnGuardrail(this, 'Guardrail', {
      name: props.name,
      description: 'multimodal-ai-knowledge-graph: content filters on the text a participant types and on the model reply, prompt attacks and profanity on the typed text only',
      ...config,
    });
    // A version is a snapshot of the guardrail and cannot change: one that names the settings
    // (their hash) is replaced, and so published again, whenever they change.
    const hash = createHash('sha256').update(JSON.stringify(stack.resolve(config))).digest('hex').slice(0, 12);
    this.version = new bedrock.CfnGuardrailVersion(this, 'Version', {
      guardrailIdentifier: this.guardrail.attrGuardrailId,
      description: `the stack's settings ${hash}`,
    });
  }

  /** What the app reads (backend config.py): the guardrail and its published version. */
  get environment(): Record<string, string> {
    return { GUARDRAIL_ID: this.guardrail.attrGuardrailId, GUARDRAIL_VERSION: this.version.attrVersion };
  }

  /**
   * `bedrock:ApplyGuardrail` on this guardrail, which a Converse call with `guardrailConfig` needs;
   * with the Standard tier, also on its profile in every Region the profile may route to.
   */
  grantApply(grantee: iam.IGrantable, policyOwner: Construct): void {
    const stack = cdk.Stack.of(this);
    const profiles = this.profileId
      ? [stack.formatArn({ service: 'bedrock', region: '*', resource: 'guardrail-profile', resourceName: this.profileId })]
      : [];
    iam.Grant.addToPrincipal({
      grantee,
      actions: ['bedrock:ApplyGuardrail'],
      resourceArns: [this.guardrail.attrGuardrailArn, ...profiles],
    });
    if (profiles.length) {
      acknowledgeWildcards(
        policyOwner,
        'cross-Region guardrail inference: ApplyGuardrail is authorized on the guardrail profile in each Region it routes to (Bedrock user guide, ' +
          '"Permissions for using cross-Region inference with Amazon Bedrock Guardrails")',
        wildcardResource(policyOwner, profiles[0]),
      );
    }
  }
}
