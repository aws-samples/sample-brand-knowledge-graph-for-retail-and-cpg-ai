// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The JSON inside a model answer. Models are asked for "only the JSON object", but some wrap it
 * in a ```json fence or add a sentence before or after it; this finds the object the same way the
 * API's ``vision.extract_json`` does, and keeps whatever surrounded it so the viewer can show it too.
 */
export type ExtractedJson = { value: unknown; before: string; after: string };

export function extractJson(raw: string): ExtractedJson | null {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const value = tryParse(fenced[1]);
    if (value !== undefined) return { value, before: text.slice(0, fenced.index).trim(), after: text.slice(fenced.index + fenced[0].length).trim() };
  }
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end <= start) return null;
  const value = tryParse(text.slice(start, end + 1));
  return value === undefined ? null : { value, before: text.slice(0, start).trim(), after: text.slice(end + 1).trim() };
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** "3 keys" / "1 item": the summary a collapsed object or array shows. */
export function sizeLabel(value: object): string {
  const n = Array.isArray(value) ? value.length : Object.keys(value).length;
  const noun = Array.isArray(value) ? 'item' : 'key';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** The first plain values of a collapsed object, such as `class: "lapel", label: "notched lapel"`
 * (whole entries only, so it reads cleanly before the " … }" the viewer adds). */
export function previewOf(value: object, maxChars = 48): string {
  if (Array.isArray(value)) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v !== null && typeof v === 'object') continue;
    const entry = `${k}: ${JSON.stringify(v)}`;
    if (parts.length && [...parts, entry].join(', ').length > maxChars) break;
    parts.push(entry.length > maxChars ? entry.slice(0, maxChars - 1) + '…' : entry);
  }
  return parts.join(', ');
}
