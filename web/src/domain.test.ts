// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { ExampleInfo, OntologySummary } from './api';
import { NEW_WORK, pickDomain, withoutNewWork } from './domain';

const listed = [{ id: 'fashion' }, { id: 'furniture' }] as OntologySummary[];

describe('the domain of the tabs', () => {
  it('is the one chosen in tab 0 while the API still lists it', () => {
    expect(pickDomain('furniture', 'fashion', listed)).toBe('furniture');
  });

  it('falls back to the ontology the graph is loaded with, then to the first one listed', () => {
    expect(pickDomain(null, 'fashion', listed)).toBe('fashion');
    expect(pickDomain('retired', 'fashion', listed)).toBe('fashion');
    expect(pickDomain('retired', 'elsewhere', listed)).toBe('fashion');
    expect(pickDomain(null, undefined, [])).toBe('');
  });

  it('never picks a browse-only domain (tab 1 step 4 lists those), even when it was stored or comes first', () => {
    const withAisles = [{ id: 'beauty', domain: { browse_only: true } }, { id: 'fashion', domain: { browse_only: false } }, { id: 'home', domain: { browse_only: true } }] as OntologySummary[];
    expect(pickDomain('beauty', 'fashion', withAisles)).toBe('fashion');
    expect(pickDomain(null, 'home', withAisles)).toBe('fashion');
    expect(pickDomain(null, undefined, withAisles)).toBe('fashion');
    expect(pickDomain(null, undefined, withAisles.filter((o) => o.domain.browse_only))).toBe('');
  });
});

describe('the example photos tabs 1 and 2 offer', () => {
  const example = (file: string, batch?: string) => ({ file, title: file, ...(batch ? { batch } : {}) }) as ExampleInfo;

  it('leave out the new work (tab 6 keeps it for its check) and keep the listing order', () => {
    const listed = [example('01-office.jpg'), example('sage-tailoring.jpg', NEW_WORK), example('fashion_1.jpg', 'new-shoot'), example('02-weekend.jpg'), example('athleisure.jpg', 'new-work')];
    expect(withoutNewWork(listed).map((e) => e.file)).toEqual(['01-office.jpg', 'fashion_1.jpg', '02-weekend.jpg']);
    expect(withoutNewWork([])).toEqual([]);
  });
});
