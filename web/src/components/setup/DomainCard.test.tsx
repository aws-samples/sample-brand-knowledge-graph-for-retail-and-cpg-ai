// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OntologySummary } from '../../api';
import { DomainCard } from './DomainCard';

/** Tab 0's domain card: each domain with its data sets (`data_sets` of `GET /api/ontologies`). */
const summary = (id: string, name: string, data_sets: string[]) =>
  ({ id, name: `${name} ontology`, stats: { classes: 10, individuals: 20 }, examples: 8, articles: 6, domain: { name, description: '' }, data_sets }) as unknown as OntologySummary;

const fashion = summary('fashion', 'Fashion', ['velloway', 'whimsikora']);
const furniture = summary('furniture', 'Furniture', []);
/** The card as a reader sees it: tags dropped, the escaped characters back. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

describe('DomainCard', () => {
  it('lists the data sets of each domain and their folder', () => {
    const html = renderToStaticMarkup(<DomainCard domain="fashion" ontologies={[fashion, furniture]} onDomain={() => {}} graphDomain="fashion" />);
    expect(text(html)).toContain('Data sets: velloway, whimsikora, each a folder ontologies/fashion/datasets/<set>/, loaded into the graph at deploy');
    expect(text(html)).toContain('No data sets yet: add one as a folder ontologies/furniture/datasets/<set>/');
    expect(text(html)).toContain('the ontology file, its examples in examples/, and its data sets (brands) in datasets/<set>/.');
    expect(text(html)).toContain('the Fashion ontology (fashion), and every data set of that domain (velloway, whimsikora), loaded at deploy.');
    expect(html).not.toContain('Style recommendation');
  });

  it('leaves out the browse-only ontologies: tab 1 step 4 shows them, they have no data to work with', () => {
    const beauty = { ...summary('beauty', 'Beauty and skincare', []), domain: { name: 'Beauty and skincare', description: '', browse_only: true } } as unknown as OntologySummary;
    const html = renderToStaticMarkup(<DomainCard domain="fashion" ontologies={[beauty, fashion, furniture]} onDomain={() => {}} graphDomain="fashion" />);
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(text(html)).not.toContain('Beauty and skincare');
    expect(text(html)).toContain('The sample ships one domain, fashion (ontologies/fashion/), and three browse-only ontologies (beauty, home, food) to read in tab 1, step 4');
  });

  it('for another domain than the graph’s: the graph holds the graph domain and its sets, tab 2 ingests the rest', () => {
    const html = renderToStaticMarkup(<DomainCard domain="furniture" ontologies={[fashion, furniture]} onDomain={() => {}} graphDomain="fashion" />);
    expect(text(html)).toContain("The graph holds the fashion vocabulary and its data sets, not this domain's. To add this domain's photos and texts to the graph, ingest them in tab 2.");
    // only the graph's domain says its sets were loaded
    expect(text(html).match(/loaded into the graph/g)).toHaveLength(1);
  });
});
