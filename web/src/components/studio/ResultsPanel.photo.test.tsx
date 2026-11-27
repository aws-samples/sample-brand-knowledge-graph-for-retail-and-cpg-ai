// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClassifyResult, OntologyDetail } from '../../api';
import recorded from '../arch/__fixtures__/classify.opus55.json';
import fashion from './__fixtures__/fashion.view.json';
import { photoPropertyLabel, RunDetails } from './ResultsPanel';
import { visibleText } from '../../visibleText';

/** Tab 1's result shows what the model said about the photo as a whole above the entities. */
const result = recorded as unknown as ClassifyResult;
const detail = { view: fashion } as unknown as OntologyDetail;
const text = (html: string) => visibleText(html, ' ').replace(/\s+/g, ' ');

describe("the photo's own values", () => {
  it('names a property by the class of its values, else by itself', () => {
    expect(photoPropertyLabel('for', detail)).toBe('Occasion');
    expect(photoPropertyLabel('for', null)).toBe('for');
    expect(photoPropertyLabel('during', detail)).toBe('during');
  });

  it('shows the occasion of the recorded answer above the entities', () => {
    expect(result.photo_properties).toEqual({ for: 'Smart casual' });
    const html = renderToStaticMarkup(<RunDetails result={result} detail={detail} onRerun={() => {}} />);
    const t = text(html);
    expect(t).toContain('Occasion: Smart casual · the photo as a whole');
    expect(html.indexOf('photo-properties')).toBeLessThan(html.indexOf('<table'));
  });

  it('shows nothing for an answer without such a property', () => {
    const html = renderToStaticMarkup(<RunDetails result={{ ...result, photo_properties: {} }} detail={detail} onRerun={() => {}} />);
    expect(html).not.toContain('photo-properties');
  });
});
