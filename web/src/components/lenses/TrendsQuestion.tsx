// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Health } from '../../api';
import { Lead, Notice } from '../retriever/Callouts';
import { TRENDS_METHODS, type Lens } from './lenses';
import { GraphAgentMethod, LakeAgentMethod } from './TrendsAgentMethods';
import type { TrendsState } from './trendsCache';

/**
 * The top of "What are the emerging trends we see this season?": the lens's lead (the three
 * methods), method 1 (the graph agent), method 2 (the Iceberg tables and the data agent), then
 * method 3's card. Method 3's stages (the map, the walk, the description) and "Side by side"
 * follow in the lenses tab, which keeps method 3's state.
 */
export function TrendsMethods({ lens, health, dataVersion, trends }: { lens: Lens; health: Health | null; dataVersion: number; trends: TrendsState }) {
  const m3 = TRENDS_METHODS.clouds;
  return (
    <>
      <div className="card">
        <Lead>{lens.lead}</Lead>
        <Notice>
          <p>{lens.notice}</p>
        </Notice>
      </div>
      <GraphAgentMethod health={health} entry={trends.graph} />
      <LakeAgentMethod entry={trends.lake} exported={trends.lakeExport} dataVersion={dataVersion} />
      <section className="card ln-method" aria-labelledby="ln-method-clouds">
        <h3 id="ln-method-clouds">{m3.title}</h3>
        <Lead>{m3.lead}</Lead>
        <p className="small ln-method-def">
          <b>New against old:</b> {m3.definition}
        </p>
      </section>
    </>
  );
}
