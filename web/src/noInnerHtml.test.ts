// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';

/**
 * Every .ts and .tsx file under web/src as text. Vite reads the folder (import.meta.glob), so the
 * test needs no Node types; the tsconfig only loads vite/client.
 */
const SOURCES = import.meta.glob<string>('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

describe('no inner HTML', () => {
  it('no app file sets dangerouslySetInnerHTML', () => {
    const files = Object.keys(SOURCES).filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'));
    expect(files).toContain('./components/arch/flow.tsx');
    expect(files.filter((file) => SOURCES[file].includes('dangerouslySetInnerHTML'))).toEqual([]);
  });
});
