// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useRef, useState } from 'react';
import { ArticleViewer } from './ArticleViewer';
import type { BatchEntry } from './batchView';

const PREVIEW_ID = 'batch-article-preview';
type PhotoEntry = Extract<BatchEntry, { kind: 'photo' | 'your photo' }>;
type TextEntry = Extract<BatchEntry, { kind: 'text' | 'your text' }>;

/**
 * Step 2 of tab 2: what the run will hydrate, before it runs. One tile per selected source (from
 * batchEntries): photos as thumbnails, texts with their kind, title and an inline "Preview as
 * article", your uploads as they are, under `heading`. The × of a tile leaves that source out of
 * the batch; the keyboard focus then moves to the × that took its place (or the one before it, or
 * the heading when none is left).
 */
export function BatchPreview({
  heading,
  ontologyId,
  entries,
  thumbs,
  disabled,
  onRemove,
}: {
  heading: string;
  ontologyId: string;
  entries: BatchEntry[];
  thumbs: Record<string, string>;
  disabled: boolean;
  onRemove: (key: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLParagraphElement>(null);
  const focusAt = useRef<number | null>(null);
  // a text left out of the batch closes its preview
  const open = entries.some((e) => e.kind === 'text' && e.file === preview) ? preview : null;
  // after a removal, the × at the same place (or the last one) gets the focus
  useEffect(() => {
    if (focusAt.current === null) return;
    const buttons = box.current?.querySelectorAll<HTMLButtonElement>('.tile-remove') ?? [];
    const next = buttons[Math.min(focusAt.current, buttons.length - 1)];
    focusAt.current = null;
    (next ?? head.current)?.focus();
  }, [entries]);
  const photos = entries.filter((e): e is PhotoEntry => e.kind === 'photo' || e.kind === 'your photo');
  const texts = entries.filter((e): e is TextEntry => e.kind === 'text' || e.kind === 'your text');
  const order = [...photos, ...texts].map((e) => e.key);
  const leaveOut = (key: string) => {
    focusAt.current = order.indexOf(key);
    onRemove(key);
  };
  const remove = (e: BatchEntry) => (
    <button type="button" className="small secondary tile-remove" disabled={disabled} onClick={() => leaveOut(e.key)} aria-label={`leave out ${e.title}`} title="Leave this source out of the batch">
      ×
    </button>
  );
  const photoTile = (e: PhotoEntry) => {
    const src = e.kind === 'photo' ? thumbs[e.file] : e.dataUrl;
    return (
      <div key={e.key} className="source-tile batch on">
        {src ? <img src={src} alt={e.title} /> : <div className="thumb-placeholder muted">loading…</div>}
        <span className="source-kind">{e.kind}</span>
        <span className="source-title">{e.title}</span>
        {remove(e)}
      </div>
    );
  };
  const textTile = (e: TextEntry) => (
    <div key={e.key} className={`source-tile text batch on${e.kind === 'text' ? ' with-link' : ''}`}>
      <div className="tile-body">
        <span className="source-kind">{e.kind === 'text' ? e.label : e.kind}</span>
        <span className="source-title">{e.title}</span>
        <span className="muted source-meta">{e.meta}</span>
      </div>
      {e.kind === 'text' && (
        <button
          type="button"
          className={`tile-link${open === e.file ? ' active' : ''}`}
          onClick={() => setPreview(open === e.file ? null : e.file)}
          aria-expanded={open === e.file}
          aria-controls={PREVIEW_ID}
        >
          {open === e.file ? 'Close preview' : 'Preview as article'}
        </button>
      )}
      {remove(e)}
    </div>
  );
  return (
    <div className="batch-preview" ref={box}>
      <p className="batch-head" ref={head} tabIndex={-1}>
        <b>{heading}</b>
      </p>
      {photos.length > 0 && <div className="source-tiles">{photos.map(photoTile)}</div>}
      {texts.length > 0 && <div className="source-tiles texts">{texts.map(textTile)}</div>}
      {open && <ArticleViewer ontologyId={ontologyId} file={open} onClose={() => setPreview(null)} id={PREVIEW_ID} />}
    </div>
  );
}
