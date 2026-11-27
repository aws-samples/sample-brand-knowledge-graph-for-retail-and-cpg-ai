// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AWS_ICONS } from './awsIcons';
import { Glyph, type Service } from './flow';

/** The attribute value as the browser reads it: renderToStaticMarkup escapes these five characters. */
function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

describe('Glyph', () => {
  it.each(Object.keys(AWS_ICONS) as Service[])('draws %s as an image of its SVG, not as inner HTML', (service) => {
    const html = renderToStaticMarkup(<Glyph service={service} />);
    expect(html).toMatch(/^<img [^>]*\/?>$/);
    const src = unescapeAttr(html.match(/ src="([^"]*)"/)?.[1] ?? '');
    const prefix = 'data:image/svg+xml,';
    expect(src.startsWith(prefix)).toBe(true);
    const svg = decodeURIComponent(src.slice(prefix.length));
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${AWS_ICONS[service].viewBox}">`)).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(html).toContain(`class="${AWS_ICONS[service].tile ? 'aws-icon tile' : 'aws-icon'}"`);
    expect(html).toContain('alt=""');
  });
});
