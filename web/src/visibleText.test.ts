// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { visibleText } from './visibleText';

describe('visibleText', () => {
  it('leaves the tags out and puts the escaped characters back', () => {
    expect(visibleText('<p class="note">Meet the <b>brands</b>: Velloway &amp; Whimsikora</p>')).toBe('Meet the brands: Velloway & Whimsikora');
    expect(visibleText('<code>datasets/&lt;set&gt;/</code> &quot;new&quot; it&#x27;s')).toBe('datasets/<set>/ "new" it\'s');
  });

  it('decodes each escaped character once', () => {
    expect(visibleText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('puts the gap in place of every tag', () => {
    expect(visibleText('<li>a</li><li>b</li>', ' ')).toBe(' a  b ');
  });
});
