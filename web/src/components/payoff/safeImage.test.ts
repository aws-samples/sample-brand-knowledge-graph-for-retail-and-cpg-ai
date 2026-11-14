// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { safeImageUrl } from './safeImage';

describe('safeImageUrl', () => {
  it('keeps the base64 raster data URLs the API sends', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    expect(safeImageUrl(png)).toBe(png);
    expect(safeImageUrl(jpeg)).toBe(jpeg);
  });

  it.each(['javascript:alert(1)', 'http://example.com/a.png', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4='])('drops %s', (url) => {
    expect(safeImageUrl(url)).toBeUndefined();
  });

  it('passes undefined through', () => {
    expect(safeImageUrl(undefined)).toBeUndefined();
  });
});
