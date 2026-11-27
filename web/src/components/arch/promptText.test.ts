// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import recorded from './__fixtures__/classify.opus55.json';
import { classTree, parsePrompt, prettyShape, sentences, type PromptSection } from './promptText';

/**
 * The readable prompt view is built from the text `owl.classification_prompt()` renders; the
 * recorded Opus 5.5 response carries the real one for the fashion ontology 1.2.0 (9,682 chars).
 */
const system: string = (recorded as { prompt: { system: string } }).prompt.system;
const section = <K extends PromptSection['kind']>(kind: K) => {
  const s = parsePrompt(system).sections.find((x) => x.kind === kind);
  if (!s) throw new Error(`no ${kind} section`);
  return s as Extract<PromptSection, { kind: K }>;
};

describe('parsePrompt', () => {
  it('splits the fashion prompt into the instruction and six sections', () => {
    const doc = parsePrompt(system);
    expect(doc.intro).toHaveLength(1);
    expect(doc.intro[0]).toMatch(/^You classify what is visible in a photo using ONLY the vocabulary/);
    expect(doc.sections.map((s) => s.kind)).toEqual(['classes', 'relations', 'attributes', 'photo', 'text', 'output']);
    expect(doc.sections.map((s) => s.title)).toEqual(['Entity classes', 'Relations between entities', 'Attribute properties', 'The whole photo', 'Ontology feedback', 'Output']);
    expect(doc.sections[0].hint).toBe('things you can locate in the image');
    expect(doc.sections[2].hint).toBe('name (applies to ...): allowed values');
    expect(doc.sections[3].hint).toBe('name: allowed values');
  });

  it('reads the properties of the whole photo: the occasion of a look, each value with its definition', () => {
    const photo = section('photo');
    expect(photo.caption).toMatch(/^For a photo of an outfit, choose at most one value per property for the outfit as a whole/);
    expect(photo.caption).toMatch(/For a text, leave "photo_properties" out\.$/);
    expect(photo.items.map((p) => p.name)).toEqual(['for']);
    const values = photo.items[0].values;
    expect(values).toHaveLength(9);
    expect(values[0]).toEqual({ name: 'Business casual', definition: 'An office without a suit.' });
    // a definition with a colon and commas stays one definition
    expect(values.find((v) => v.name === 'Evening')).toEqual({ name: 'Evening', definition: 'An evening out: dinner, drinks, a show.' });
    expect(values.map((v) => v.name)).toContain('Dress');
    // the occasion is not an attribute of a garment
    expect(section('attributes').items.map((a) => a.name)).not.toContain('for');
    // a value without a definition, and a line that is not the layout: kept as a list, never lost
    const other = parsePrompt('## The whole photo (name: allowed values)\nPick one.\n- during: Rainy; Sunny (Clear sky.)').sections[0];
    expect(other).toEqual({ kind: 'photo', title: 'The whole photo', hint: 'name: allowed values', caption: 'Pick one.', items: [{ name: 'during', values: [{ name: 'Rainy' }, { name: 'Sunny', definition: 'Clear sky.' }] }] });
    expect(parsePrompt('## The whole photo\n- not a property line').sections[0].kind).toBe('list');
  });

  it('turns indented bullets into the class tree, with labels and synonyms', () => {
    const doc = parsePrompt(system);
    const classes = doc.sections[0];
    if (classes.kind !== 'classes') throw new Error('expected classes');
    expect(classes.caption).toMatch(/^Format: ClassName/);
    expect(classes.roots.map((r) => r.name)).toEqual(['Apparel', 'GarmentComponent']);
    const apparel = classes.roots[0];
    const groups = apparel.children.map((c) => c.name);
    expect(groups).toContain('ArmsAndHandsAccessory');
    expect(groups).toContain('UpperBodyGarment');
    const headwear = apparel.children.find((c) => c.name === 'Headwear')!;
    expect(headwear.label).toBe('Head');
    const headband = headwear.children.find((c) => c.name === 'Headband')!;
    expect(headband.synonyms).toEqual(['hair accessory', 'head covering']);
    expect(headband.label).toBeUndefined();
    const legWarmer = apparel.children.find((c) => c.name === 'LegsAndFeetwear')!.children.find((c) => c.name === 'LegWarmer')!;
    expect(legWarmer.label).toBe('leg warmer');
    // the jewelry the sample adds to Fashionpedia's other accessories, with its synonyms
    const others = apparel.children.find((c) => c.name === 'OtherAccessory')!;
    expect(others.children.map((c) => c.name)).toEqual(['Bag', 'Bracelet', 'Earring', 'Necklace', 'Ring', 'Scarf', 'Umbrella']);
    expect(others.children.find((c) => c.name === 'Earring')!.synonyms).toEqual(['ear stud', 'hoop']);
    expect(others.children.find((c) => c.name === 'Bracelet')!.synonyms).toEqual(['bangle', 'cuff bracelet']);
    // every "- " line of the section became exactly one node
    const bulletLines = system.split('\n## ')[1].split('\n').filter((l) => /^\s*- /.test(l)).length;
    expect(classes.count).toBe(bulletLines);
    expect(doc.counts.classes).toBe(classes.count);
  });

  it('reads relations as name, domain → range', () => {
    const doc = parsePrompt(system);
    const rel = doc.sections[1];
    if (rel.kind !== 'relations') throw new Error('expected relations');
    expect(rel.items).toEqual([{ name: 'hasPart', domain: ['Apparel'], range: ['GarmentComponent'] }]);
  });

  it('reads attribute properties with the classes they apply to and their allowed values', () => {
    const doc = parsePrompt(system);
    const attrs = doc.sections[2];
    if (attrs.kind !== 'attributes') throw new Error('expected attributes');
    const length = attrs.items.find((a) => a.name === 'hasLength')!;
    expect(length.appliesTo).toEqual(['UpperBodyGarment', 'LowerBodyGarment', 'WholeBodyGarment']);
    expect(length.values[0]).toBe('above-the-hip (length)');
    expect(length.values).toContain('midi');
    expect(length.values.at(-1)).toBe('wrist-length');
    const neck = attrs.items.find((a) => a.name === 'hasNecklineType')!;
    expect(neck.values).toHaveLength(25);
    expect(neck.values).toContain('v-neck');
    expect(attrs.valueCount).toBe(attrs.items.reduce((n, a) => n + a.values.length, 0));
    expect(doc.counts.attributes).toBe(attrs.items.length);
    expect(doc.counts.values).toBe(attrs.valueCount);
  });

  it('keeps the feedback ask as prose and splits the output contract into lead, shape and rules', () => {
    const fb = section('text');
    expect(fb.title).toBe('Ontology feedback');
    expect(fb.paragraphs).toHaveLength(1);
    expect(fb.paragraphs[0]).toMatch(/^This ontology is a work in progress and you are also its reviewer/);
    const out = section('output');
    expect(out.lead).toEqual(['Return ONLY a JSON object, no prose, with this shape:']);
    expect(out.shape.startsWith('{"entities": [{"id": "e1"')).toBe(true);
    expect(out.rules[0]).toMatch(/^Coordinates are integers on a 0-1000 scale/);
    expect(out.rules.at(-1)).toBe("Only use attribute properties that apply to the entity's class and only values from the allowed list.");
    expect(out.rules).toHaveLength(4);
  });

  it('never loses text: every non-blank line of the prompt is in the parsed document', () => {
    const doc = parsePrompt(system);
    const rendered: string[] = [...doc.intro];
    for (const s of doc.sections) {
      rendered.push(s.title, s.hint ?? '');
      if (s.kind === 'classes') {
        rendered.push(s.caption ?? '');
        const walk = (items: typeof s.roots) => items.forEach((c) => (rendered.push(c.name, c.label ?? '', ...c.synonyms), walk(c.children)));
        walk(s.roots);
      } else if (s.kind === 'relations') s.items.forEach((r) => rendered.push(r.name, ...r.domain, ...r.range));
      else if (s.kind === 'attributes') s.items.forEach((a) => rendered.push(a.name, ...a.appliesTo, ...a.values));
      else if (s.kind === 'photo') rendered.push(s.caption ?? '', ...s.items.flatMap((p) => [p.name, ...p.values.flatMap((v) => [v.name, v.definition ?? ''])]));
      else if (s.kind === 'output') rendered.push(...s.lead, s.shape, ...s.rules);
      else if (s.kind === 'list') s.items.forEach((i) => rendered.push(i.text));
      else rendered.push(...s.paragraphs);
    }
    const haystack = rendered.join('\n');
    for (const line of system.split('\n').filter((l) => l.trim())) {
      // headers and bullets are split into their parts, prose into sentences; every piece is present
      const parts = line
        .replace(/^## (.*?)\s+\((.*)\)$/, '$1: $2')
        .replace(/^## /, '')
        .replace(/^\s*- /, '')
        .split(/ \[also: |\]$|: | -> |\(applies to |\), |, |; | \((?!applies to )/)
        .flatMap((p) => sentences(p))
        .map((p) => p.trim())
        .filter(Boolean);
      for (const p of parts) expect(haystack, `missing "${p}" from "${line.slice(0, 60)}"`).toContain(p.replace(/[)(]$/, ''));
    }
    // and nothing was invented: the parsed document has exactly the prompt's characters, minus the
    // layout words the view replaces with structure ("[also: …]", "(applies to …)", "->", "; ")
    const squash = (s: string) => s.replace(/\bapplies to\b|\balso\b|->|^## /gm, '').replace(/[\s\-\[\]():;,.]/g, '');
    expect(squash(haystack)).toHaveLength(squash(system).length);
  });

  it('is tolerant of prompts from other ontologies: no relations, unknown sections, a shape it cannot read', () => {
    const doc = parsePrompt(['Intro line.', '', '## Entity classes (x)', '- A', '  - B: bee', '- C', '', '## Extra notes', 'Plain paragraph.', '- a bullet', '', '## Output', 'Shape:', '{"a": [1, 2}', 'Rule one. Rule two.'].join('\n'));
    expect(doc.sections.map((s) => s.kind)).toEqual(['classes', 'list', 'output']);
    const classes = doc.sections[0];
    if (classes.kind !== 'classes') throw new Error('expected classes');
    expect(classes.roots.map((r) => [r.name, r.children.map((c) => c.name)])).toEqual([
      ['A', ['B']],
      ['C', []],
    ]);
    expect(doc.counts).toEqual({ classes: 3, relations: 0, attributes: 0, values: 0 });
    const out = doc.sections[2];
    if (out.kind !== 'output') throw new Error('expected output');
    expect(out.rules).toEqual(['Rule one.', 'Rule two.']);
    expect(prettyShape(out.shape)).toBe('{"a": [1, 2}'); // unreadable: shown as it is
    expect(parsePrompt('just text').intro).toEqual(['just text']);
    expect(classTree(['- x', '    - deep', '- y'])[0].children[0].name).toBe('deep');
    // the label is everything after the first ": ", once the "[also: ...]" suffix is stripped
    expect(classTree(['- C: sea: open water [also: ocean, main]'])[0]).toEqual({ name: 'C', label: 'sea: open water', synonyms: ['ocean', 'main'], children: [] });
  });
});

describe('prettyShape', () => {
  it('indents the JSON-like output shape one member per line, scalar arrays inline', () => {
    const out = section('output');
    const pretty = prettyShape(out.shape);
    const lines = pretty.split('\n');
    expect(lines[0]).toBe('{');
    expect(lines[1]).toBe('  "entities": [');
    expect(lines[2]).toBe('    {');
    expect(lines).toContain('      "bbox": [x_min, y_min, x_max, y_max],');
    expect(lines).toContain('      "confidence": 0.0-1.0,');
    expect(lines).toContain('  "photo_properties": {');
    expect(lines).toContain('    "<property>": "<allowed value>"');
    expect(lines).toContain('  "ontology_feedback": [');
    expect(lines).toContain('      "kind": "class|value|property|relation",');
    expect(lines.at(-2)).toBe('  "notes": "<anything else you could not map to the ontology>"');
    expect(lines.at(-1)).toBe('}');
    // nothing but whitespace was added: collapsing it gives the original back
    expect(pretty.replace(/\s+/g, '')).toBe(out.shape.replace(/\s+/g, ''));
  });

  it('splits rules into sentences without breaking on abbreviations inside quotes', () => {
    expect(sentences('One. Two, "quoted. still" three. (Four) five.')).toEqual(['One.', 'Two, "quoted. still" three.', '(Four) five.']);
    expect(sentences('x_min, y_min ... in "parts" of the entity. Always use.')).toEqual(['x_min, y_min ... in "parts" of the entity.', 'Always use.']);
  });
});
