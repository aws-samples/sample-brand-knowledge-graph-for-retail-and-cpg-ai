// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { isStoredPhotoKey } from '../../api';

// The same rule as backend previews.STORED_PHOTO: `<set>/<sub>/<file>`, so the browser only asks for keys the API accepts.
describe('isStoredPhotoKey', () => {
  it.each([
    ['anycompany-fashion-house/looks/a.jpg', true],
    ['anycompany-fashion-house/looks/fashion_dress_1.jpg', true],
    ['anycompany-fashion-house/products/item_-123.jpg', true],
    ['anycompany-fashion-house/other/a.jpg', true],
    ['anycompany-apparel/looks/utility-01.png', true],
    ['a/b/c/d.jpg', false],
    ['Whim/looks/a.jpg', false],
    ['anycompany-fashion-house/Looks/a.jpg', false],
    ['anycompany-fashion-house/looks/../x.jpg', false],
    ['anycompany-fashion-house/looks/../runs/x.jpg', false],
    ['anycompany-fashion-house/looks/a..jpg', false],
    ['anycompany-fashion-house/looks/a.json', false],
    ['anycompany-fashion-house/looks/sub/a.jpg', false],
    ['looks/a.jpg', false],
    ['runs/run-1/run.json', false],
    ['product_images/item_1.png', false],
    ['', false],
  ])('%s → %s', (key, ok) => {
    expect(isStoredPhotoKey(key)).toBe(ok);
  });
  it('is false for no key', () => expect(isStoredPhotoKey(undefined)).toBe(false));
});
