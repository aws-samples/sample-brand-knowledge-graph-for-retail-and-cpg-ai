// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { Prism } from 'prism-react-renderer';
import type { ClassifyResult } from '../../api';
import recorded from './__fixtures__/classify.opus55.json';
import { PROMPT, TURTLE } from './grammars';

/** The tokens of `text`, flattened to `type:content` pairs (nested tokens listed after their parent). */
function flat(text: string, language: string): string[] {
  const out: string[] = [];
  const textOf = (t: string | Prism.Token | (string | Prism.Token)[]): string => (typeof t === 'string' ? t : Array.isArray(t) ? t.map(textOf).join('') : textOf(t.content));
  const walk = (tokens: (string | Prism.Token)[]) => {
    for (const t of tokens) {
      if (typeof t === 'string') continue;
      out.push(`${t.type}:${textOf(t)}`);
      if (Array.isArray(t.content)) walk(t.content);
    }
  };
  walk(Prism.tokenize(text, Prism.languages[language]));
  return out;
}

describe('the Turtle grammar', () => {
  it('is registered on the Prism of the code viewer', () => {
    expect(Prism.languages[TURTLE]).toBeDefined();
    expect(Prism.languages[PROMPT]).toBeDefined();
  });
  it('tokenises a prefix declaration: keyword, namespace, IRI, dot', () => {
    expect(flat('@prefix fo: <http://example.org/multimodal-ai-knowledge-graph/fashion#> .', TURTLE)).toEqual([
      'keyword:@prefix',
      'prefixed-name:fo:',
      'namespace:fo:',
      'iri:<http://example.org/multimodal-ai-knowledge-graph/fashion#>',
      'punctuation:.',
    ]);
  });
  it('reads the # of an IRI as part of the IRI, not as a comment', () => {
    const tokens = flat('<http://www.w3.org/2002/07/owl#> a owl:Ontology ; # a note', TURTLE);
    expect(tokens).toContain('iri:<http://www.w3.org/2002/07/owl#>');
    expect(tokens).toContain('comment:# a note');
    expect(tokens.filter((t) => t.startsWith('comment:'))).toHaveLength(1);
  });
  it('splits a prefixed name into its namespace and a class or a property', () => {
    expect(flat('fo:Coat a owl:Class ;', TURTLE)).toEqual(['prefixed-name:fo:Coat', 'namespace:fo:', 'class-name:Coat', 'keyword:a', 'prefixed-name:owl:Class', 'namespace:owl:', 'class-name:Class', 'punctuation:;']);
    expect(flat('    rdfs:subClassOf fo:Outerwear .', TURTLE)).toEqual(['prefixed-name:rdfs:subClassOf', 'namespace:rdfs:', 'property:subClassOf', 'prefixed-name:fo:Outerwear', 'namespace:fo:', 'class-name:Outerwear', 'punctuation:.']);
  });
  it('keeps a language-tagged string together and marks the tag', () => {
    expect(flat('    rdfs:label "coat (a finish)"@en ;', TURTLE)).toEqual(['prefixed-name:rdfs:label', 'namespace:rdfs:', 'property:label', 'string:"coat (a finish)"@en', 'language-tag:@en', 'punctuation:;']);
  });
  it('marks a datatype and reads the escapes of a string', () => {
    const tokens = flat('fo:x fo:count "3"^^xsd:integer ; fo:note "a \\"quoted\\" word" .', TURTLE);
    expect(tokens).toContain('string:"3"^^xsd:integer');
    expect(tokens).toContain('datatype:^^xsd:integer');
    expect(tokens).toContain('string:"a \\"quoted\\" word"');
  });
  it('knows comments, booleans and numbers', () => {
    expect(flat('# SPDX-License-Identifier: CC-BY-4.0', TURTLE)).toEqual(['comment:# SPDX-License-Identifier: CC-BY-4.0']);
    expect(flat('    fo:visual false ;', TURTLE)).toContain('boolean:false');
    expect(flat('    fo:order 12 .', TURTLE)).toContain('number:12');
  });
});

describe('the prompt grammar', () => {
  const system = (recorded as unknown as ClassifyResult).prompt.system;
  it('marks the headings', () => {
    const headings = flat(system, PROMPT).filter((t) => t.startsWith('heading:'));
    expect(headings).toContain('heading:## Entity classes (things you can locate in the image)');
    expect(headings).toContain('heading:## Output');
    expect(headings).toHaveLength(system.split('\n').filter((l) => l.startsWith('## ')).length);
  });
  it('marks the term of a list item as a class or a property, and the bullet', () => {
    expect(flat('  - Headband [also: hair accessory, head covering]', PROMPT)).toEqual(['bullet:  -', 'class-name:Headband', 'synonyms:[also: hair accessory, head covering]']);
    expect(flat('- hasPart: Apparel -> GarmentComponent', PROMPT)).toEqual(['bullet:-', 'property:hasPart', 'arrow:->']);
    expect(flat('- hasAnimalMaterial (applies to Glove, Hat): cheetah, zebra', PROMPT)).toEqual(['bullet:-', 'property:hasAnimalMaterial', 'applies-to:(applies to Glove, Hat)']);
  });
  it('tokenises the JSON shape under Output as JSON and the quoted names in the prose as strings', () => {
    const tokens = flat(system, PROMPT);
    const shape = tokens.find((t) => t.startsWith('json:{'));
    expect(shape).toMatch(/^json:\{"entities": \[.*"notes": "<anything else you could not map to the ontology>"\}$/);
    expect(tokens).toContain('property:"entities"');
    expect(tokens).toContain('string:"<EntityClass>"');
    expect(tokens).toContain('string:"ontology_feedback"');
    expect(tokens.filter((t) => t.startsWith('json:'))).toHaveLength(1);
  });
});
