// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { RetrieverTraversal } from '../../api';
import { walkState } from './StageGraph';

const run = (categories: number) => ({ cypher: 'MATCH', categories: Array.from({ length: categories }, (_, i) => ({ id: `cat:${i}` })) }) as unknown as RetrieverTraversal;

describe('stage 4: the traversal', () => {
  it('is ready once it ran and found something to count', () => {
    expect(walkState(null)).toBe('none');
    expect(walkState(run(3))).toBe('ready');
    expect(walkState(run(0))).toBe('empty');
  });
});
