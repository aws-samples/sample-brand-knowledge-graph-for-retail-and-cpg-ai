// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { SetupStatus } from '../../api';

/**
 * The stack's Neptune Analytics graph: its status and size, the VPC and private endpoint it is
 * reached through, and the console link.
 */
export function GraphCard({ s }: { s: SetupStatus }) {
  const g = s.graph;
  const nep = g.neptune;
  const nepReady = nep?.status === 'AVAILABLE';
  return (
    <section className="card setup-card">
      <h3>
        The graph: Amazon Neptune Analytics <span className={`setup-pill ${nepReady ? 'ok' : 'todo'}`}>{nep?.status?.toLowerCase() ?? 'not found'}</span>
      </h3>
      <p>
        {nep ? (
          <>
            <code>{nep.graph_id}</code>
            {nep.nodes !== undefined ? ` · ${nep.nodes?.toLocaleString()} nodes · ${nep.edges?.toLocaleString()} edges` : ''}
            {nep.memory ? ` · ${nep.memory} m-NCU` : ''}
            {nep.error ? ` · ${nep.error}` : ''}
          </>
        ) : (
          'No graph found.'
        )}
      </p>
      {g.network && (
        <p>
          Private: reachable only from VPC <code>{g.network.vpc_id}</code>, through endpoint <code>{g.network.endpoint_id}</code>; the counts above came through it. The stack reaches the
          other AWS services through a regional NAT gateway.
        </p>
      )}
      <p className="muted">The brand&apos;s looks, preloaded: each look, its garments and its occasion, and the ontology. It has its own vector index (which finds tab 4&apos;s starting garments) and answers openCypher.</p>
      {nep?.console_url && (
        <div className="setup-actions">
          <a className="button-link" href={nep.console_url} target="_blank" rel="noopener noreferrer">
            Neptune console <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      )}
    </section>
  );
}
