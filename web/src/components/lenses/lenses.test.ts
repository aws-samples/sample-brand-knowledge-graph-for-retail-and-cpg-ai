// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { ExampleInfo } from '../../api';
import * as lensesModule from './lenses';
import { LENSES, NO_NEW_WORK, PERSONAS, lensesOf, newWorkPhotos, splitCitationLetters, splitCitations, verdictOf } from './lenses';

const example = (file: string, batch?: string, extra: Partial<ExampleInfo> = {}): ExampleInfo => ({
  file,
  title: file,
  bytes: 1,
  content_type: 'image/jpeg',
  prompt: '',
  model_id: '',
  ...(batch ? { batch } : {}),
  ...extra,
});

describe('lenses', () => {
  it('splits a finding into text and row citations', () => {
    expect(splitCitations('Hoops in 34 looks [1], belts [2].')).toEqual(['Hoops in 34 looks ', 1, ', belts ', 2, '.']);
  });

  it('splits a finding into text, item citations and look letters', () => {
    expect(splitCitationLetters('Wide legs [1], cream [2, 4] in looks [A] and [B, C].')).toEqual([
      'Wide legs ',
      { kind: 'item', n: 1 },
      ', cream ',
      { kind: 'item', n: 2 },
      { kind: 'item', n: 4 },
      ' in looks ',
      { kind: 'look', letter: 'A' },
      ' and ',
      { kind: 'look', letter: 'B' },
      { kind: 'look', letter: 'C' },
      '.',
    ]);
    expect(splitCitationLetters('no citation [x] here')).toEqual(['no citation [x] here']);
  });

  it('gives the buyer and the merchandiser three questions, the creative director four: the photo check, then the trends map', () => {
    expect(lensesOf('buyer')).toHaveLength(3);
    expect(lensesOf('merch')).toHaveLength(3);
    expect(lensesOf('creative').map((l) => l.id)).toEqual(['on-brand', 'trends', 'style-guide', 'thin']);
    expect(lensesOf('creative')[1].input).toEqual({ kind: 'map' });
    expect(new Set(LENSES.map((l) => l.id)).size).toBe(10);
    expect(PERSONAS).toHaveLength(3);
  });

  it('offers the domain’s new work as the outfits to check, in listing order, and no hard-coded list', () => {
    const listed = [
      example('01-office.jpg'),
      example('sage-tailoring.jpg', 'new-work', { data_set: 'whimsikora', title: 'Sage blazer, cream trousers, white sneakers', origin: 'New shoot' }),
      example('fashion_1.jpg', 'new-shoot', { data_set: 'whimsikora' }),
      example('trench-midi.jpg', 'new-work', { data_set: 'whimsikora', origin: 'Supplier sample' }),
      example('athleisure.jpg', 'new-work', { data_set: 'whimsikora' }),
    ];
    const outfits = newWorkPhotos(listed);
    expect(outfits.map((x) => x.file)).toEqual(['sage-tailoring.jpg', 'trench-midi.jpg', 'athleisure.jpg']);
    expect(outfits[0]).toMatchObject({ title: 'Sage blazer, cream trousers, white sneakers', origin: 'New shoot' });
    expect(lensesModule).not.toHaveProperty('BRAND_PHOTOS');
  });

  it('says how to add new work when the domain has none', () => {
    expect(newWorkPhotos([example('01-office.jpg'), example('fashion_1.jpg', 'new-shoot')])).toEqual([]);
    expect(newWorkPhotos([])).toEqual([]);
    expect(NO_NEW_WORK).toContain('no example photos marked as new work');
    expect(NO_NEW_WORK).toContain('"batch": "new-work"');
    expect(NO_NEW_WORK).toContain('examples/images/');
  });

  it('applies the verdict rule to the main pieces only (as the backend does)', () => {
    const piece = (main: boolean, fits: boolean) => ({ main, fits });
    expect(verdictOf([piece(true, true), piece(false, false)])).toBe('on-brand');
    expect(verdictOf([piece(true, true), piece(true, true), piece(true, false)])).toBe('partly');
    expect(verdictOf([piece(true, true), piece(true, true), piece(true, false), piece(true, false)])).toBe('partly');
    expect(verdictOf([piece(true, true), piece(true, false), piece(true, false)])).toBe('off-brand');
  });
});

describe('the same question in beauty', () => {
  it('every question has its beauty version, worded as a question', () => {
    for (const l of LENSES) expect(l.beauty, l.id).toMatch(/\?$/);
  });
});
