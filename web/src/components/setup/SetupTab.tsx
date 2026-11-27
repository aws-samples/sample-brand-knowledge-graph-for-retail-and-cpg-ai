// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { OntologySummary } from '../../api';
import { AgentCard } from './AgentCard';
import { DomainCard } from './DomainCard';
import { GraphCard } from './GraphCard';
import { GuardrailCard } from './GuardrailCard';
import { ModelsCard } from './ModelsCard';
import { CatalogCard } from './CatalogCard';
import { PipelineCard } from './PipelineCard';
import { AgentPill, ReadyPill } from './setupView';
import { useSetupStatus } from './useSetupStatus';

/**
 * Tab 0's "What's deployed" section: what this sample runs on AWS (backend/src/ontology_rag/setup.py).
 * The CloudFormation stack owns every resource and this only reports them, with console links. The
 * domain (which folder under ontologies/ the other tabs work with, and its data sets) is the one
 * choice here, and it is the browser's. One card per concern; useSetupStatus reads the status. The
 * lakehouse (tab 6's trends method 2) reports its own status in tab 6.
 */
export function SetupDetails({
  domain,
  ontologies,
  onDomain,
  graphDomain,
}: {
  domain: string;
  ontologies: OntologySummary[];
  onDomain: (id: string) => void;
  /** The domain whose ontology the graph is loaded with (`default` of `GET /api/ontologies`). */
  graphDomain: string;
}) {
  const { status: s, error } = useSetupStatus();

  if (!s) return <div className="stack">{error ? <p className="error">{error}</p> : <p className="muted">Reading what is set up…</p>}</div>;

  const domainName = ontologies.find((o) => o.id === domain)?.domain.name ?? domain;

  return (
    <div className="stack setup-tab">
      <div>
        <p className="muted">
          Your account has its own copy of everything below, created by AWS CloudFormation before you started, with the brand&apos;s graph and product catalog already loaded. This is what the other
          tabs run on, with a link to each resource in the AWS console.
        </p>
        <div className="setup-checklist">
          <span>
            Domain <span className="setup-pill ok">{domainName}</span>
          </span>
          <span>
            Neptune Analytics graph <ReadyPill ok={s.graph.neptune?.status === 'AVAILABLE'} />
          </span>
          <span>
            Query agent <AgentPill ag={s.agent} />
          </span>
          <span>
            Product catalog (S3 Vectors) <ReadyPill ok={s.catalog.configured} />
          </span>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <DomainCard domain={domain} ontologies={ontologies} onDomain={onDomain} graphDomain={graphDomain} />
      <GraphCard s={s} />
      <AgentCard s={s} />
      <CatalogCard s={s} />
      <PipelineCard />
      <ModelsCard s={s} />
      <GuardrailCard s={s} />
    </div>
  );
}
