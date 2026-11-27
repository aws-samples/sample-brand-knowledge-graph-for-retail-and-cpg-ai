// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Text in an SVG box without a canvas: width estimates, where the lines go, word wrap. Shared by
 * the drawings that lay out labeled boxes (tab 2's run graph and batch graph).
 */

export type Measure = (text: string, font: number, bold: boolean) => number;

/** Font sizes of a box's main lines and its sub-line. */
export const FONTS = { sub: 10.5 } as const;
const LINE = 1.28;
const PAD_Y = 6;
const SUB_GAP = 2;

/** Horizontal padding inside a label box, on each side (as in tab 1). */
export const labelPadding = (font: number) => font * 0.6;
const lineHeight = (font: number) => font * LINE;

/** Where the text goes inside a box: line centers and the sub-line center, from the box's top. */
export function textRows(font: number, lines: number, hasSub: boolean) {
  const lh = lineHeight(font);
  return {
    padX: labelPadding(font),
    lineY: Array.from({ length: lines }, (_, i) => PAD_Y + lh * (i + 0.5)),
    subY: PAD_Y + lh * lines + SUB_GAP + lineHeight(FONTS.sub) / 2,
    height: PAD_Y * 2 + lh * lines + (hasSub ? SUB_GAP + lineHeight(FONTS.sub) : 0),
  };
}

/** Text width without a canvas: the average glyph of a UI font is ~0.55 em, bold ~0.6 em. */
export const defaultMeasure: Measure = (text, font, bold) => text.length * font * (bold ? 0.6 : 0.55);

/** First meaningful line of a name / text: markdown heading marks and emphasis stripped, whitespace collapsed. */
export function displayText(raw: unknown): string {
  const s = String(raw ?? '');
  const line = s
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^[-*_=]{3,}$/.test(l));
  return (line ?? '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[*_`]+|[*_`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Greedy word wrap into at most `maxLines` lines of `max` characters; the last line ends in "…" when cut. */
export function wrapText(text: string, max: number, maxLines: number): string[] {
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => (w.length <= max ? [w] : (w.match(new RegExp(`.{1,${max - 1}}`, 'g')) ?? [w])));
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + w.length <= max) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  if (!lines.length) return [''];
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let s = kept[maxLines - 1];
  while (s.length + 1 > max) {
    const cut = s.lastIndexOf(' ');
    s = cut > 0 ? s.slice(0, cut) : s.slice(0, max - 1);
  }
  kept[maxLines - 1] = s.replace(/[\s,;:.\u2013\u2014-]+$/, '') + '…';
  return kept;
}
