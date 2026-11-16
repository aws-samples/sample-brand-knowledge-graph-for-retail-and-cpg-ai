// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/** The characters React escapes in markup, by entity name. */
const ESCAPED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" };

/**
 * Markup from `renderToStaticMarkup` as a reader sees it, for the tests' text assertions: the tags
 * left out and the escaped characters back. React escapes `<` and `>` in text and in attribute
 * values, so a tag ends at the first `>`. Each entity is decoded once (`&amp;lt;` stays `&lt;`).
 * `gap` stands in for every tag; a space keeps the words of neighboring elements apart.
 */
export function visibleText(html: string, gap = ''): string {
  let text = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') {
      inTag = true;
    } else if (ch === '>' && inTag) {
      inTag = false;
      text += gap;
    } else if (!inTag) {
      text += ch;
    }
  }
  return text.replace(/&(amp|lt|gt|quot|#x27);/g, (_, name: string) => ESCAPED[name]);
}
