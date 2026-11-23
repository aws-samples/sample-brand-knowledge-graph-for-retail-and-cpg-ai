// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The app's tabs: their ids (the `?tab=` of the URL) and labels, shared by the tab bar (App) and
 * tab 0's list of what you will do (StartTab). The emerging trends are the creative director's
 * second question in tab 6.
 */
export type Tab = 'setup' | 'ask' | 'stylist' | 'ingest' | 'explore' | 'graph' | 'lenses';
export const TAB_IDS: readonly Tab[] = ['setup', 'explore', 'ingest', 'graph', 'ask', 'stylist', 'lenses'];
export const TABS: { id: Tab; label: string }[] = [
  { id: 'setup', label: '0 · Start here' },
  { id: 'explore', label: '1 · Ontology explorer' },
  { id: 'ingest', label: '2 · Hydrate the graph' },
  { id: 'graph', label: '3 · Explore the graph' },
  { id: 'ask', label: '4 · Build the retriever' },
  { id: 'stylist', label: '5 · Compare GraphRAG with traditional methods' },
  { id: 'lenses', label: '6 · What else the graph knows · BONUS' },
];
