// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OntoNode } from '../../api';
import { definitionLine, OntologyFile } from './OntologyFile';

// the component imports the API client, whose sign-in and signing modules need a browser
vi.mock('../../auth', () => ({ signIn: async () => {} }));
vi.mock('../../signing', () => ({ signedRequest: async (_m: string, path: string, headers: Record<string, string>) => ({ url: path, headers }), forgetCredentials: () => {} }));

const FO = 'http://example.org/multimodal-ai-knowledge-graph/fashion#';
const BE = 'http://example.org/multimodal-ai-knowledge-graph/beauty#';
const TURTLE = [
  '# a short file in the shape of the sample ontologies',
  `@prefix fo: <${FO}> .`,
  `@prefix be: <${BE}> .`,
  '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
  '',
  'fo:CoatPart a owl:Class ;',
  '    rdfs:subClassOf fo:Part .',
  '',
  'fo:Coat a owl:Class ;',
  '    rdfs:label "coat"@en ;',
  '    rdfs:subClassOf fo:Outerwear .',
  '',
  'be:Coat a owl:Class ;',
  '    rdfs:label "coat (a finish)"@en .',
  '',
  `<${FO}hasLength> a owl:ObjectProperty ;`,
  '    rdfs:domain fo:Coat .',
].join('\n');

const node = (iri: string): OntoNode => ({ id: iri, key: iri, label: '', kind: 'class' });

describe('the line that defines a term', () => {
  it('is the subject line written with the prefix of the term namespace, never a longer name that starts the same', () => {
    expect(definitionLine(TURTLE, `${FO}Coat`)).toBe(8);
    expect(definitionLine(TURTLE, `${FO}CoatPart`)).toBe(5);
  });
  it('tells two prefixes apart by their IRI', () => {
    expect(definitionLine(TURTLE, `${BE}Coat`)).toBe(12);
  });
  it('falls back to the full IRI in angle brackets', () => {
    expect(definitionLine(TURTLE, `${FO}hasLength`)).toBe(15);
  });
  it('is null for a term the file never defines, or one it only refers to', () => {
    expect(definitionLine(TURTLE, `${FO}Shoe`)).toBeNull();
    expect(definitionLine(TURTLE, `${FO}Outerwear`)).toBeNull();
    expect(definitionLine(TURTLE, `${FO}Part`)).toBeNull();
  });
});

describe('the file viewer', () => {
  it('names the file in its summary and the hint', () => {
    const html = renderToStaticMarkup(<OntologyFile ontologyId="fashion" file="fashion.ttl" node={null} />);
    expect(html).toContain('Inspect: the ontology file (fashion.ttl)');
    expect(html).toContain('the OWL source, as the app reads it');
    expect(html).not.toContain('onto-file-pre'); // closed: nothing is read or shown yet
  });
  it('shows the given text line by line, with the definition of the selected term highlighted', () => {
    const html = renderToStaticMarkup(<OntologyFile ontologyId="fashion" file="fashion.ttl" node={node(`${FO}Coat`)} text={TURTLE} defaultOpen />);
    expect(html).toContain('Showing the definition of Coat (line 9).');
    expect(html.match(/class="onto-line onto-line-hit"/g)).toHaveLength(1);
    expect(html).toMatch(/class="onto-line onto-line-hit" data-line="9"><span class="onto-ln" aria-hidden="true">9<\/span>fo:Coat a owl:Class ;/);
    expect(html.match(/class="onto-line"/g)).toHaveLength(TURTLE.split('\n').length - 1);
  });
  it('says so when the selected term has no line of its own, and counts the lines when nothing is selected', () => {
    expect(renderToStaticMarkup(<OntologyFile ontologyId="fashion" file="fashion.ttl" node={node(`${FO}Shoe`)} text={TURTLE} defaultOpen />)).toContain('Shoe has no definition line of its own in this file.');
    expect(renderToStaticMarkup(<OntologyFile ontologyId="fashion" file="fashion.ttl" node={null} text={TURTLE} defaultOpen />)).toContain('17 lines. Select a term in step 1 to jump to its definition.');
  });
});
