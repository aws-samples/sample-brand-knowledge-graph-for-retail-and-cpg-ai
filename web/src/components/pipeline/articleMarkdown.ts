// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Just enough Markdown for the example texts (editorial pieces, social posts, product notes) to be
 * previewed as a blog page: headings, paragraphs, lists, quotes, **bold**, _italic_ and #hashtags.
 * The parser returns plain data, and the page renders it as React elements (never as HTML), so a
 * text dropped into the examples folder cannot inject markup.
 */
export type Inline = { kind: 'text' | 'bold' | 'italic' | 'tag'; text: string };
export type Block =
  | { kind: 'heading'; level: 2 | 3; text: Inline[] }
  | { kind: 'paragraph'; text: Inline[] }
  | { kind: 'quote'; text: Inline[] }
  | { kind: 'list'; items: Inline[][] };
export type Article = { title: string; byline: string; blocks: Block[]; tags: string[]; words: number };

const INLINE = /(\*\*[^*]+\*\*|(?<!\w)_[^_]+_(?!\w)|(?<!\w)\*[^*]+\*(?!\w)|(?<![\w#])#[\p{L}\p{N}_-]+)/u;
const HASHTAGS_ONLY = /^(#[\p{L}\p{N}_-]+\s*)+$/u;
const LIST_ITEM = /^\s*[-*]\s+/;

/** `**bold** and _italic_ #tag` → typed spans, in order. */
function parseInline(line: string): Inline[] {
  return line
    .split(INLINE)
    .filter(Boolean)
    .map((part): Inline => {
      if (part.startsWith('**')) return { kind: 'bold', text: part.slice(2, -2) };
      if (part.length > 2 && (part.startsWith('_') || part.startsWith('*')) && part.endsWith(part[0])) return { kind: 'italic', text: part.slice(1, -1) };
      if (part.startsWith('#') && part.length > 1) return { kind: 'tag', text: part.slice(1) };
      return { kind: 'text', text: part };
    });
}

/** Lines separated by blank lines → one chunk per paragraph, heading, list or quote. */
function chunks(text: string): string[][] {
  const out: string[][] = [[]];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim()) out[out.length - 1].push(line.trim());
    else if (out[out.length - 1].length) out.push([]);
  }
  return out.filter((c) => c.length);
}

/**
 * The article: the leading `# Title` and the `_source · kind · date_` line under it become the
 * header, a closing line of hashtags becomes tags, and everything else is the body.
 */
export function parseArticle(text: string): Article {
  const article: Article = { title: '', byline: '', blocks: [], tags: [], words: text.split(/\s+/).filter(Boolean).length };
  for (const lines of chunks(text)) {
    const first = lines[0];
    if (!article.title && !article.blocks.length && /^#\s/.test(first)) {
      article.title = first.replace(/^#\s+/, '');
    } else if (article.title && !article.byline && !article.blocks.length && lines.length === 1 && /^_.+_$/.test(first)) {
      article.byline = first.slice(1, -1);
    } else if (/^#{2,3}\s/.test(first)) {
      const level = first.startsWith('###') ? 3 : 2;
      article.blocks.push({ kind: 'heading', level, text: parseInline(first.replace(/^#+\s+/, '')) });
    } else if (lines.every((l) => LIST_ITEM.test(l))) {
      article.blocks.push({ kind: 'list', items: lines.map((l) => parseInline(l.replace(LIST_ITEM, ''))) });
    } else if (lines.every((l) => l.startsWith('>'))) {
      article.blocks.push({ kind: 'quote', text: parseInline(lines.map((l) => l.replace(/^>\s?/, '')).join(' ')) });
    } else if (lines.length === 1 && HASHTAGS_ONLY.test(first)) {
      article.tags.push(...first.split(/\s+/).map((t) => t.slice(1)));
    } else {
      article.blocks.push({ kind: 'paragraph', text: parseInline(lines.join(' ')) });
    }
  }
  return article;
}
