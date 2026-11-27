// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArchitectureDiagram, flowEdges, flowNodes, selectionFor, type Def } from './ArchitectureDiagram';

/** A two-node panel: a Lambda that is step 1, a context node (the browser) and a zone standing for the Lambda. */
type NodeId = 'browser' | 'fn';
type Ctx = { busy: boolean };
const DEF: Def<NodeId, Ctx> = {
  title: 'How the test works',
  summary: ({ busy }) => (busy ? 'in flight' : 'Lambda'),
  steps: [{ n: 1, node: 'fn', title: 'The call', summary: 'One Lambda call.' }],
  text: { 1: <p>The browser calls the function.</p> },
  nodes: ({ busy, pulse }) => [
    { zone: true, id: 'zone', selectAs: 'fn', x: 200, y: 0, width: 300, height: 120, title: 'AWS Lambda', tone: 'lambda' },
    { id: 'browser', service: 'browser', x: 0, y: 40, title: 'Browser', sub: 'the app', status: pulse ? 'done' : 'idle' },
    { id: 'fn', parent: 'zone', service: 'lambda', x: 30, y: 40, title: 'AWS Lambda · api', sub: busy ? 'working' : 'idle', status: busy ? 'active' : 'idle' },
  ],
  edges: ({ busy, pulse }) => [{ id: 'e-call', source: 'browser', sourceHandle: 's-r', target: 'fn', targetHandle: 't-l', label: 'request', active: busy, done: pulse }],
  legend: ({ busy }) => (busy ? 'request in flight' : 'Follow the number.'),
};
const live = { busy: false, pulse: false };

describe('ArchitectureDiagram', () => {
  it('turns the boxes into React Flow nodes: badges from the steps, context greyed, the zone selected with the node it stands for', () => {
    const nodes = flowNodes(DEF, DEF.nodes(live), 'fn');
    expect(nodes.map((n) => [n.id, n.type])).toEqual([
      ['zone', 'zone'],
      ['browser', 'service'],
      ['fn', 'service'],
    ]);
    const [zone, browser, fn] = nodes;
    expect(zone.data).toMatchObject({ title: 'AWS Lambda', tone: 'lambda', selected: true, steps: undefined });
    expect(browser.data).toMatchObject({ steps: undefined, muted: true });
    expect(browser.selected).toBe(false);
    expect(fn.data).toMatchObject({ steps: [1], muted: false, status: 'idle' });
    expect(fn.selected).toBe(true);
    expect(fn.parentId).toBe('zone');
    expect(nodes.every((n) => n.draggable === false)).toBe(true);
  });

  it('colours an edge by its state and lifts it above the zones when there are any', () => {
    const idle = flowEdges(DEF.edges(live), true)[0];
    expect(idle).toMatchObject({ source: 'browser', target: 'fn', sourceHandle: 's-r', targetHandle: 't-l', type: 'flow', zIndex: 1, data: { label: 'request', active: false, done: false } });
    expect(idle.markerEnd).toMatchObject({ color: '#9aa5b1' });
    expect(flowEdges(DEF.edges({ busy: true, pulse: false }), false)[0]).toMatchObject({ zIndex: undefined, markerEnd: { color: '#ff9900' } });
    expect(flowEdges(DEF.edges({ busy: false, pulse: true }), false)[0].markerEnd).toMatchObject({ color: '#037f0c' });
  });

  it('selects the first step of a clicked box, the node alone for a context box, and the node a zone stands for', () => {
    const boxes = DEF.nodes(live);
    expect(selectionFor(DEF, boxes, 'fn')).toEqual({ step: 1, node: 'fn' });
    expect(selectionFor(DEF, boxes, 'browser')).toEqual({ step: null, node: 'browser' });
    expect(selectionFor(DEF, boxes, 'zone')).toEqual({ step: 1, node: 'fn' });
  });

  it('renders the panel: the title and summary when closed; the legend, the step list and the step text when open', () => {
    const closed = renderToStaticMarkup(<ArchitectureDiagram def={DEF} ctx={{ busy: false }} codeSet="explorer" open={false} onToggle={() => undefined} />);
    expect(closed).toContain('class="card panel arch-panel"');
    expect(closed).toContain('How the test works');
    expect(closed).toContain('Lambda · click a number');
    expect(closed).not.toContain('step-list');

    const open = renderToStaticMarkup(<ArchitectureDiagram def={DEF} ctx={{ busy: true }} codeSet="explorer" open onToggle={() => undefined} details={(node) => <p className="test-detail">selected {node}</p>} />);
    expect(open).toContain('in flight · click a number');
    expect(open).toContain('request in flight');
    expect(open).toContain('class="flow-wrap flow-explorer"');
    expect(open).toMatch(/<ol class="step-list"[^>]*>.*The call.*<\/ol>/s);
    expect(open).toContain('Step 1 · The call');
    expect(open).toContain('The browser calls the function.');
    expect(open).toContain('selected fn');
    expect(open).toContain('Loading code…');
  });
});
