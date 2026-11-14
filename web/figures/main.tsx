// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { StrictMode, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../src/styles.css';
import './figures.css';
import { edgeTypes, Legend, nodeTypes, tileOf, toEdges, toNodes } from './kit';
import { FIGURES } from './specs';

// ?figure=<name> picks the figure; render.mjs screenshots #figure once every edge is drawn.
// PAD keeps the badges on the outermost tiles' corners inside the canvas.
const PAD = 20;
const name = new URLSearchParams(location.search).get('figure') ?? 'architecture';
const spec = FIGURES[name];
document.title = name;

function Figure() {
  const tile = tileOf(spec);
  const style = { width: spec.width + 2 * PAD, height: spec.height + 2 * PAD, '--svc-w': `${tile.width}px`, '--svc-muted-w': `${tile.muted}px` } as CSSProperties;
  return (
    <div id="figure" className={`figure${spec.large ? ' large' : ''}`} style={style} data-edges={spec.edges.length}>
      <ReactFlow
        nodes={toNodes(spec.nodes)}
        edges={toEdges(spec.edges)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={{ x: PAD, y: PAD, zoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
      />
      <Legend items={spec.legend} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{spec ? <Figure /> : <p>Unknown figure {name}</p>}</StrictMode>,
);
