// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { CodeSet } from '../../api';
import { DEF as PIPELINE } from '../pipeline/PipelinePanel';
import { DEF as LENS_TRENDS } from '../lenses/TrendsArchitecture';
import { DEF as QUERY } from '../query/QueryArchitecture';
import { DEFS as RETRIEVER } from '../retriever/RetrieverArchitecture';
import { DEF as EXPLORER } from '../studio/ArchitecturePanel';
import { DEFS as TRENDS } from '../lenses/TrendsAgentsArchitecture';
import type { Def, Live } from './ArchitectureDiagram';
// The one copy of the contract, read from the backend package (the API loads the same file).
import NODE_IDS from '../../../../backend/src/ontology_rag/code_panel_nodes.json';

/**
 * The "How it works" contract between the API's code snippets and the diagrams: a snippet names
 * the diagram nodes it is attached to (`nodes` in code_panel.py), and clicking a box lists the
 * snippets attached to it. `code_panel_nodes.json` is the set of ids a snippet of each code set may
 * name. The backend's test asserts that every snippet stays inside it; this one asserts that the
 * file is exactly the boxes of the diagram showing that set: no id a click could never reach, no
 * box missing. A zone that stands for another node (`selectAs`) is not a box of its own.
 */
/** A diagram drawn with nothing in flight: the boxes a snippet may be attached to, and its steps. */
function drawn<NodeId extends string, Ctx>(def: Def<NodeId, Ctx>, ctx: Ctx) {
  const boxes = def.nodes({ ...ctx, pulse: false } as Live<Ctx>).filter((b) => !('zone' in b && b.selectAs));
  return { title: def.title, boxes: boxes.map((b) => b.id as string).sort(), steps: def.steps.map((s) => s.node as string) };
}

const DIAGRAMS: Record<CodeSet, ReturnType<typeof drawn>> = {
  explorer: drawn(EXPLORER, { arch: null, detail: null, ontologyId: 'fashion', models: [], running: [], runningLabel: '', latestRequest: undefined, latestResult: null }),
  pipeline: drawn(PIPELINE, { arch: null, status: null, models: [] }),
  query: drawn(QUERY, { direct: false, agent: false, result: null, graphId: '', host: null }),
  rt_catalog: drawn(RETRIEVER.rt_catalog, { running: false }),
  rt_rag: drawn(RETRIEVER.rt_rag, { running: false }),
  rt_graph: drawn(RETRIEVER.rt_graph, { running: false }),
  rt_payoff: drawn(RETRIEVER.rt_payoff, { running: false }),
  trends_graph: drawn(TRENDS.graph, { busy: '', detail: {} }),
  trends_lake: drawn(TRENDS.lake, { busy: '', detail: {} }),
  lens_trends: drawn(LENS_TRENDS, { running: false }),
};

describe('code panel node ids', () => {
  it('covers every code set the API serves', () => {
    expect(Object.keys(NODE_IDS).sort()).toEqual(Object.keys(DIAGRAMS).sort());
  });

  for (const [set, ids] of Object.entries(NODE_IDS) as [CodeSet, string[]][]) {
    it(`${set}: the file lists exactly the boxes of its diagram`, () => {
      expect([...ids].sort()).toEqual(DIAGRAMS[set].boxes);
    });
  }

  it('every step of every diagram sits on one of its own boxes', () => {
    for (const d of Object.values(DIAGRAMS)) expect(d.steps.filter((node) => !d.boxes.includes(node)), d.title).toEqual([]);
  });
});
