// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { SetupStatus } from '../../api';
import { modelRows } from './setupView';

const status = {
  models: {
    embedding: 'amazon.nova-2-multimodal-embeddings-v1:0',
    vision: ['global.anthropic.claude-sonnet-5-5', 'us.amazon.nova-pro-v1:0'],
    answer: ['global.anthropic.claude-sonnet-5-5'],
  },
} as SetupStatus;

describe('setup tab', () => {
  it('lists every model once with all its roles', () => {
    expect(modelRows(status).map((r) => [r.id, r.roles])).toEqual([
      ['amazon.nova-2-multimodal-embeddings-v1:0', ['embedding']],
      ['global.anthropic.claude-sonnet-5-5', ['answer', 'vision']],
      ['us.amazon.nova-pro-v1:0', ['vision']],
    ]);
  });
});
