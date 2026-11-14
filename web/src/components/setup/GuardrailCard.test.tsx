// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SetupStatus } from '../../api';
import { GuardrailCard } from './GuardrailCard';

/** Tab 0's What's deployed: the guardrail the stack creates, or that none is configured. */
const status = (guardrail: SetupStatus['guardrail']) => ({ region: 'us-east-1', guardrail }) as SetupStatus;

describe('GuardrailCard', () => {
  it('names the deployed guardrail and its version, with the console link', () => {
    const html = renderToStaticMarkup(<GuardrailCard s={status({ configured: true, guardrail_id: 'gr123', version: '1' })} />);
    expect(html).toContain('gr123');
    expect(html).toContain('version 1');
    expect(html).toContain('prompt attacks');
    // the profanity list checks only the typed text (infra/lib/guardrail.ts), the content filters both sides
    expect(html).toContain('the model&#x27;s reply to it for hate, insults, sexual content, violence and misconduct.');
    expect(html).toContain('https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/guardrails');
  });

  it('says when none is configured', () => {
    const html = renderToStaticMarkup(<GuardrailCard s={status({ configured: false, guardrail_id: null, version: null })} />);
    expect(html).toContain('No guardrail is configured');
    expect(html).not.toContain('Guardrails console');
  });
});
