// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe as group, expect, it } from 'vitest';
import { adjacency, describe, lightUp, search, type Web } from './webView';

// Two looks that share nothing but the kind of their shoes; a text about the first one.
const node = (id: string, label: string, name: string, run: string | null = null) => ({ id, label, name, image_key: null, run });
const WEB: Web = {
  nodes: [
    node('look:a', 'Look', 'look a', 'run-1'),
    node('look:b', 'Look', 'look b'),
    node('item:a1', 'Item', 'white leather sneaker'),
    node('item:a2', 'Item', 'black tote'),
    node('item:b1', 'Item', 'white platform sneaker'),
    node('category:shoe', 'Category', 'shoe'),
    node('category:bag', 'Category', 'bag'),
    node('occasion:dress', 'Occasion', 'Dress'),
    node('st:x-1', 'Statement', 'White sneakers with a denim skirt'),
  ],
  edges: [
    { source: 'look:a', type: 'CONTAINS', target: 'item:a1' },
    { source: 'look:a', type: 'CONTAINS', target: 'item:a2' },
    { source: 'look:b', type: 'CONTAINS', target: 'item:b1' },
    { source: 'item:a1', type: 'IS_CATEGORY', target: 'category:shoe' },
    { source: 'item:b1', type: 'IS_CATEGORY', target: 'category:shoe' },
    { source: 'item:a2', type: 'IS_CATEGORY', target: 'category:bag' },
    { source: 'look:b', type: 'FOR', target: 'occasion:dress' },
    { source: 'st:x-1', type: 'ILLUSTRATES', target: 'look:a' },
  ],
  cypher: [],
};
const adj = adjacency(WEB);

group("the explorer's web", () => {
  it('a look lights up its garments, their kinds and the text about it, not the other look', () => {
    const lit = lightUp(adj, 'look:a');
    expect([...lit].sort()).toEqual(['category:bag', 'category:shoe', 'item:a1', 'item:a2', 'look:a', 'st:x-1']);
    expect(lit.has('look:b')).toBe(false);
  });

  it('a kind lights up every garment of it and every look they are in: where looks meet', () => {
    expect([...lightUp(adj, 'category:shoe')].sort()).toEqual(['category:shoe', 'item:a1', 'item:b1', 'look:a', 'look:b']);
    expect(describe(adj, 'category:shoe').line).toBe('2 garments in 2 looks');
  });

  it('an occasion lights up its looks, a text the look it is about', () => {
    expect([...lightUp(adj, 'occasion:dress')].sort()).toEqual(['look:b', 'occasion:dress']);
    expect(lightUp(adj, 'st:x-1').has('look:a')).toBe(true);
    expect(describe(adj, 'st:x-1')).toMatchObject({ line: 'about a look', looks: ['look:a'] });
  });

  it('a search finds every garment with all the words, and the looks they are in', () => {
    expect(search(adj, 'white sneaker')).toEqual({ garments: ['item:a1', 'item:b1'], looks: ['look:a', 'look:b'] });
    expect(search(adj, 'White  LEATHER')).toEqual({ garments: ['item:a1'], looks: ['look:a'] });
    expect(search(adj, '  ')).toEqual({ garments: [], looks: [] });
  });

  it('the side panel says what a node is in counts', () => {
    expect(describe(adj, 'look:a')).toMatchObject({ line: '2 garments · 1 text about it', garments: ['item:a1', 'item:a2'] });
    expect(describe(adj, 'look:b').line).toBe('1 garment · for Dress');
    expect(describe(adj, 'item:a1')).toMatchObject({ line: 'a shoe · in 1 look', looks: ['look:a'] });
  });
});
