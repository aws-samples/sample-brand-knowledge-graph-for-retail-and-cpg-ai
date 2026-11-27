// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ExampleInfo, OntologySummary } from './api';

/** The browser remembers the domain chosen in tab 0 · Start here under this key. */
export const DOMAIN_KEY = 'oaai.domain';

/**
 * The domain the tabs work with: the one chosen in tab 0 when the API still lists it, else the
 * one the graph is loaded with (`default` of `GET /api/ontologies`), else the first one listed.
 * Tabs 1 to 4 classify against that domain's ontology and offer its example photos, texts
 * and questions. The sample ships one domain (fashion) and three browse-only ontologies
 * (`domain.browse_only`: no data, tab 1 step 4 only), which are never picked; a folder added next
 * to them under `ontologies/` becomes a choice here.
 */
export function pickDomain(stored: string | null, graphDomain: string | undefined, ontologies: OntologySummary[]): string {
  const ids = ontologies.filter((o) => !o.domain?.browse_only).map((o) => o.id);
  for (const candidate of [stored, graphDomain]) {
    if (candidate && ids.includes(candidate)) return candidate;
  }
  return ids[0] ?? '';
}

/** A domain noun at the start of a heading or sentence ("garment" → "Garment"). */
export function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The `batch` of the example photos tab 6 checks ("Is this new photo on-brand?"): outfits the graph
 * has never seen, marked `"batch": "new-work"` in a manifest of an `examples/images/` folder.
 */
export const NEW_WORK = 'new-work';

/** The example photos tabs 1 and 2 offer: every listed one except the new work, which tab 6 keeps for its check. */
export function withoutNewWork(examples: ExampleInfo[]): ExampleInfo[] {
  return examples.filter((e) => e.batch !== NEW_WORK);
}
