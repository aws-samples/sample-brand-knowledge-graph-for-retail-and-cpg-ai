// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { isHttpUrl } from './links';

describe('isHttpUrl', () => {
  it('accepts http and https URLs, whatever the case of the scheme', () => {
    expect(isHttpUrl('https://example.com/ontology')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('HTTPS://EXAMPLE.COM/x')).toBe(true);
  });

  it('refuses every other scheme and anything that is not a URL', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'ftp://example.com', 'example.com', 'Fashion ontology (internal)', '', ' https://example.com']) {
      expect(isHttpUrl(value)).toBe(false);
    }
  });
});
