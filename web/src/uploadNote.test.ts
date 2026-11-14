// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';

/** Every .tsx file under web/src as text (import.meta.glob, as in noInnerHtml.test.ts). */
const SOURCES = import.meta.glob<string>('./**/*.tsx', { query: '?raw', import: 'default', eager: true });

describe('upload controls', () => {
  it('every component with an upload control shows what may be uploaded (UploadNote)', () => {
    const app = Object.keys(SOURCES).filter((file) => !file.endsWith('.test.tsx') && !file.endsWith('ImageDrop.tsx'));
    const uploads = app.filter((file) => /type="file"|<ImageDrop\b/.test(SOURCES[file]));
    expect(uploads.sort()).toEqual(['./components/payoff/PhotoPicker.tsx', './components/pipeline/SourcePicker.tsx', './components/studio/StudioToolbar.tsx']);
    expect(uploads.filter((file) => !SOURCES[file].includes('<UploadNote'))).toEqual([]);
  });
});
