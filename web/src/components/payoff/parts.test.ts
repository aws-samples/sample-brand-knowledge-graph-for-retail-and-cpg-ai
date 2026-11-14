// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { garmentsOf } from './parts';

describe('garmentsOf', () => {
  it("lists a look's garments once each, with how many times the photo shows them", () => {
    expect(garmentsOf('Outfit in a photo: gray wool coat, black loafer, gold earring, black loafer')).toEqual([
      { name: 'gray wool coat', n: 1 },
      { name: 'black loafer', n: 2 },
      { name: 'gold earring', n: 1 },
    ]);
  });

  it('copes with an empty description', () => {
    expect(garmentsOf('')).toEqual([]);
  });
});
