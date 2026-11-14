// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Parse the system prompt that `owl.classification_prompt()` renders from an ontology into a
 * document the browser can lay out for reading: the instruction, the entity-class hierarchy,
 * relations, attribute properties with their allowed values, the properties of the photo as a
 * whole (the look's occasion) with each value's definition, the ontology-feedback ask and the
 * output contract. The prompt is plain text with `## ` section headers and `- ` bullets; nothing
 * here depends on the ontology, only on that layout, so an uploaded ontology renders the same way.
 * Anything the parser does not recognise falls back to paragraphs, never to nothing.
 */

export interface ClassItem {
  name: string;
  label?: string;
  synonyms: string[];
  children: ClassItem[];
}

interface RelationItem {
  name: string;
  domain: string[];
  range: string[];
}

export interface AttributeItem {
  name: string;
  appliesTo: string[];
  values: string[];
}

/** One value of a property of the whole photo, with its definition when the ontology gives one. */
export interface PhotoValue {
  name: string;
  definition?: string;
}

export interface PhotoPropertyItem {
  name: string;
  values: PhotoValue[];
}

export type PromptSection =
  | { kind: 'classes'; title: string; hint?: string; caption?: string; roots: ClassItem[]; count: number }
  | { kind: 'relations'; title: string; hint?: string; items: RelationItem[] }
  | { kind: 'attributes'; title: string; hint?: string; items: AttributeItem[]; valueCount: number }
  | { kind: 'photo'; title: string; hint?: string; caption?: string; items: PhotoPropertyItem[] }
  | { kind: 'output'; title: string; hint?: string; lead: string[]; shape: string; rules: string[] }
  | { kind: 'list'; title: string; hint?: string; caption?: string; items: { text: string; depth: number }[] }
  | { kind: 'text'; title: string; hint?: string; paragraphs: string[] };

export interface PromptDoc {
  /** The paragraphs before the first section: the instruction. */
  intro: string[];
  sections: PromptSection[];
  /** Counts for the summary line (0 when a section is absent). */
  counts: { classes: number; relations: number; attributes: number; values: number };
}

const BULLET = /^(\s*)- (.*)$/;

export function parsePrompt(text: string): PromptDoc {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const intro: string[] = [];
  const blocks: { title: string; hint?: string; lines: string[] }[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('## ')) {
      const { title, hint } = splitTitle(line.slice(3));
      blocks.push({ title, hint, lines: [] });
    } else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
    else if (line.trim()) intro.push(line.trim());
  }
  const sections = blocks.map(parseSection);
  const counts = { classes: 0, relations: 0, attributes: 0, values: 0 };
  for (const s of sections) {
    if (s.kind === 'classes') counts.classes += s.count;
    if (s.kind === 'relations') counts.relations += s.items.length;
    if (s.kind === 'attributes') {
      counts.attributes += s.items.length;
      counts.values += s.valueCount;
    }
  }
  return { intro, sections, counts };
}

/** "Entity classes (things you can locate in the image)" into a title and the parenthetical hint. */
function splitTitle(s: string): { title: string; hint?: string } {
  const m = /^(.*?)\s+\((.*)\)$/.exec(s.trim());
  return m ? { title: m[1], hint: m[2] } : { title: s.trim() };
}

function parseSection(b: { title: string; hint?: string; lines: string[] }): PromptSection {
  const body = trimBlank(b.lines);
  const key = b.title.toLowerCase();
  const bullets = body.filter((l) => BULLET.test(l));
  const prose = body.filter((l) => l.trim() && !BULLET.test(l));
  if (key.startsWith('entity classes') || (bullets.length && key.includes('class'))) {
    const caption = prose.find((l) => /^format:/i.test(l));
    const roots = classTree(bullets);
    return { kind: 'classes', title: b.title, hint: b.hint, caption, roots, count: countClasses(roots) };
  }
  if (key.startsWith('relations')) {
    const items = bullets.map(parseRelation).filter((r): r is RelationItem => r !== null);
    if (items.length === bullets.length) return { kind: 'relations', title: b.title, hint: b.hint, items };
  }
  if (key.startsWith('attribute')) {
    const items = bullets.map(parseAttribute).filter((a): a is AttributeItem => a !== null);
    if (items.length === bullets.length) {
      return { kind: 'attributes', title: b.title, hint: b.hint, items, valueCount: items.reduce((n, a) => n + a.values.length, 0) };
    }
  }
  if (key.startsWith('the whole photo')) {
    const items = bullets.map(parsePhotoProperty).filter((p): p is PhotoPropertyItem => p !== null);
    if (items.length === bullets.length) return { kind: 'photo', title: b.title, hint: b.hint, caption: prose.join(' ') || undefined, items };
  }
  if (key === 'output') {
    const shapeAt = body.findIndex((l) => l.trim().startsWith('{'));
    if (shapeAt >= 0) {
      const lead = body.slice(0, shapeAt).filter((l) => l.trim());
      const rules = body
        .slice(shapeAt + 1)
        .filter((l) => l.trim())
        .flatMap(sentences);
      return { kind: 'output', title: b.title, hint: b.hint, lead, shape: body[shapeAt].trim(), rules };
    }
  }
  if (bullets.length) {
    const caption = prose[0];
    return { kind: 'list', title: b.title, hint: b.hint, caption, items: bullets.map((l) => ({ text: BULLET.exec(l)![2], depth: Math.floor(BULLET.exec(l)![1].length / 2) })) };
  }
  return { kind: 'text', title: b.title, hint: b.hint, paragraphs: prose };
}

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let z = lines.length;
  while (a < z && !lines[a].trim()) a++;
  while (z > a && !lines[z - 1].trim()) z--;
  return lines.slice(a, z);
}

/** Indented bullets ("  - Name: label [also: a, b]") into a tree; two spaces per level. */
export function classTree(bullets: string[]): ClassItem[] {
  const roots: ClassItem[] = [];
  const stack: { depth: number; item: ClassItem }[] = [];
  for (const line of bullets) {
    const m = BULLET.exec(line);
    if (!m) continue;
    const depth = Math.floor(m[1].length / 2);
    const item = parseClass(m[2]);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1].item.children.push(item);
    else roots.push(item);
    stack.push({ depth, item });
  }
  return roots;
}

/**
 * "Name: label [also: a, b]" into its parts. The `[also: ...]` suffix is stripped first, so the
 * colon inside it is never taken for the separator; the label is everything after the first ": ".
 */
function parseClass(s: string): ClassItem {
  let rest = s.trim();
  let synonyms: string[] = [];
  const also = /\s*\[also: ([^\]]*)\]$/.exec(rest);
  if (also) {
    synonyms = splitList(also[1]);
    rest = rest.slice(0, also.index);
  }
  const sep = rest.indexOf(': ');
  if (sep >= 0) return { name: rest.slice(0, sep).trim(), label: rest.slice(sep + 2).trim(), synonyms, children: [] };
  return { name: rest.trim(), synonyms, children: [] };
}

function countClasses(items: ClassItem[]): number {
  return items.reduce((n, c) => n + 1 + countClasses(c.children), 0);
}

/** "- hasPart: Apparel -> GarmentComponent" */
function parseRelation(line: string): RelationItem | null {
  const m = /^\s*- ([^:]+): (.*?) -> (.*)$/.exec(line);
  return m ? { name: m[1].trim(), domain: splitList(m[2]), range: splitList(m[3]) } : null;
}

/** "- hasLength (applies to UpperBodyGarment, LowerBodyGarment): mini, midi, maxi" */
function parseAttribute(line: string): AttributeItem | null {
  const m = /^\s*- (\S+) \(applies to (.*?)\): ?(.*)$/.exec(line);
  return m ? { name: m[1], appliesTo: splitList(m[2]), values: splitList(m[3]) } : null;
}

/** "- for: Casual (Relaxed everyday wear.); Dress" */
function parsePhotoProperty(line: string): PhotoPropertyItem | null {
  const m = /^\s*- ([^:\s]+): (.*)$/.exec(line);
  if (!m) return null;
  const values = m[2]
    .split('; ')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => {
      const d = /^(.*?) \((.*)\)$/.exec(v);
      return d ? { name: d[1], definition: d[2] } : { name: v };
    });
  return { name: m[1], values };
}

function splitList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Split prose into sentences at ". " followed by a capital, a quote or a bracket. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"([])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------------------------------------------ the output shape, indented
// The shape in the prompt is JSON-like, not JSON: it carries placeholders such as `0.0-1.0`,
// `[x_min, y_min, x_max, y_max]` and `"<EntityClass>"`. A tolerant reader turns it into a tree
// and prints objects one member per line while arrays of scalars stay on one line.

type Shape = { t: 'obj'; entries: [string, Shape][] } | { t: 'arr'; items: Shape[] } | { t: 'raw'; text: string };

export function prettyShape(shape: string): string {
  try {
    const [node, end] = readValue(shape, 0);
    if (shape.slice(end).trim()) throw new Error('trailing text');
    return print(node, 0);
  } catch {
    return shape; // not the layout we know: show it as it is
  }
}

function readValue(s: string, i: number): [Shape, number] {
  i = skipWs(s, i);
  if (s[i] === '{') {
    const entries: [string, Shape][] = [];
    i++;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === '}') return [{ t: 'obj', entries }, i + 1];
      if (s[i] !== '"') throw new Error(`key expected at ${i}`);
      const keyEnd = closingQuote(s, i);
      const key = s.slice(i, keyEnd + 1);
      i = skipWs(s, keyEnd + 1);
      if (s[i] !== ':') throw new Error(`: expected at ${i}`);
      const [val, next] = readValue(s, i + 1);
      entries.push([key, val]);
      i = skipWs(s, next);
      if (s[i] === ',') i++;
      else if (s[i] !== '}') throw new Error(`, or } expected at ${i}`);
    }
  }
  if (s[i] === '[') {
    const items: Shape[] = [];
    i++;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === ']') return [{ t: 'arr', items }, i + 1];
      const [val, next] = readValue(s, i);
      items.push(val);
      i = skipWs(s, next);
      if (s[i] === ',') i++;
      else if (s[i] !== ']') throw new Error(`, or ] expected at ${i}`);
    }
  }
  // a scalar or placeholder: up to the next delimiter, quotes respected
  let j = i;
  while (j < s.length) {
    if (s[j] === '"') j = closingQuote(s, j) + 1;
    else if (s[j] === ',' || s[j] === '}' || s[j] === ']') break;
    else j++;
  }
  if (j === i) throw new Error(`value expected at ${i}`);
  return [{ t: 'raw', text: s.slice(i, j).trim() }, j];
}

function closingQuote(s: string, open: number): number {
  for (let k = open + 1; k < s.length; k++) {
    if (s[k] === '\\') k++;
    else if (s[k] === '"') return k;
  }
  throw new Error('unterminated string');
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

function print(node: Shape, depth: number): string {
  const pad = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);
  if (node.t === 'raw') return node.text;
  if (node.t === 'arr') {
    if (node.items.every((x) => x.t === 'raw')) return `[${node.items.map((x) => print(x, 0)).join(', ')}]`;
    return `[\n${node.items.map((x) => inner + print(x, depth + 1)).join(',\n')}\n${pad}]`;
  }
  if (!node.entries.length) return '{}';
  return `{\n${node.entries.map(([k, v]) => `${inner}${k}: ${print(v, depth + 1)}`).join(',\n')}\n${pad}}`;
}
