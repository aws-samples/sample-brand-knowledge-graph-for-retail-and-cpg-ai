// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useRef, useState } from 'react';
import { fileToDataUrl, type ArticleInfo, type ExampleInfo } from '../../api';
import { MAX_IMAGE_MB } from '../../limits';
import { UploadNote } from '../shared/UploadNote';
import { ARTICLE_PREVIEW_ID, ArticleViewer } from './ArticleViewer';

/**
 * Pick the batch: example photos and texts from the domain's `examples/images/` and
 * `examples/articles/` folders (referenced by name; the bytes never leave the server) plus your
 * own uploads (sent once, stored under uploads/<run>/ in the data bucket). Every tile toggles; the
 * run takes the selected set. Each example text opens a blog-style preview of itself inline, under
 * the example texts (ArticleViewer).
 */
export type Upload =
  | { key: string; kind: 'image'; name: string; dataUrl: string; bytes: number }
  | { key: string; kind: 'text'; title: string; text: string; bytes: number };

export function SourcePicker({
  ontologyId,
  examples,
  articles,
  thumbs,
  uploads,
  selected,
  disabled,
  onToggle,
  onSelectAll,
  onAddUploads,
  onRemoveUpload,
}: {
  ontologyId: string;
  examples: ExampleInfo[];
  articles: ArticleInfo[];
  thumbs: Record<string, string>;
  uploads: Upload[];
  selected: Set<string>;
  disabled: boolean;
  onToggle: (key: string) => void;
  onSelectAll: (keys: string[], on: boolean) => void;
  onAddUploads: (uploads: Upload[]) => void;
  onRemoveUpload: (key: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageKeys = examples.map((e) => `img:${e.file}`);
  const textKeys = articles.map((a) => `txt:${a.file}`);
  const allImages = imageKeys.length > 0 && imageKeys.every((k) => selected.has(k));
  const allTexts = textKeys.length > 0 && textKeys.every((k) => selected.has(k));

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const out: Upload[] = [];
    for (const f of Array.from(files)) {
      const key = `up:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (f.type.startsWith('image/')) {
        out.push({ key, kind: 'image', name: f.name, dataUrl: await fileToDataUrl(f), bytes: f.size });
      } else {
        const body = await f.text();
        out.push({ key, kind: 'text', title: f.name.replace(/\.(md|txt)$/i, ''), text: body, bytes: f.size });
      }
    }
    onAddUploads(out);
  }

  function addText() {
    if (text.trim().length < 20) return;
    const key = `up:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    onAddUploads([{ key, kind: 'text', title: title.trim() || text.trim().slice(0, 60), text: text.trim(), bytes: text.length }]);
    setTitle('');
    setText('');
  }

  return (
    <div className="card sources">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, flex: '1 1 auto' }}>Sources: {selected.size} selected</h3>
        <span className="muted">Photos and texts go through the same steps: one ontology prompt, one JSON answer, one MERGE.</span>
      </div>

      <div className="source-group">
        <div className="source-head">
          <h4>Example photos</h4>
          <button className="small secondary" disabled={disabled || !imageKeys.length} onClick={() => onSelectAll(imageKeys, !allImages)}>
            {allImages ? 'none' : 'all'}
          </button>
        </div>
        <div className="source-tiles">
          {examples.map((e) => {
            const key = `img:${e.file}`;
            const on = selected.has(key);
            return (
              <button key={key} type="button" className={`source-tile${on ? ' on' : ''}`} disabled={disabled} onClick={() => onToggle(key)} aria-pressed={on} title={e.file}>
                {thumbs[e.file] ? <img src={thumbs[e.file]} alt={e.title} /> : <div className="thumb-placeholder muted">loading…</div>}
                <span className="source-title">{e.title}</span>
              </button>
            );
          })}
          {!examples.length && <p className="muted">This ontology folder has no example images.</p>}
        </div>
      </div>

      <div className="source-group">
        <div className="source-head">
          <h4>Example texts</h4>
          <button className="small secondary" disabled={disabled || !textKeys.length} onClick={() => onSelectAll(textKeys, !allTexts)}>
            {allTexts ? 'none' : 'all'}
          </button>
        </div>
        <div className="source-tiles texts">
          {articles.map((a) => {
            const key = `txt:${a.file}`;
            const on = selected.has(key);
            return (
              <div key={key} className={`source-tile text with-link${on ? ' on' : ''}`}>
                <button type="button" className="tile-body" disabled={disabled} onClick={() => onToggle(key)} aria-pressed={on} title={a.file}>
                  <span className="source-kind">{a.kind}</span>
                  <span className="source-title">{a.title}</span>
                  <span className="muted source-meta">
                    {a.source}
                    {a.published ? ` · ${a.published}` : ''} · {a.chars.toLocaleString()} chars
                  </span>
                </button>
                {/* a read-only preview, so it stays clickable while a run is going */}
                <button
                  type="button"
                  className={`tile-link${preview === a.file ? ' active' : ''}`}
                  onClick={() => setPreview((p) => (p === a.file ? null : a.file))}
                  aria-expanded={preview === a.file}
                  aria-controls={ARTICLE_PREVIEW_ID}
                  title={preview === a.file ? 'Close the preview' : 'Shows a blog-style preview of this text below the example texts'}
                >
                  <svg viewBox="0 0 16 16" aria-hidden>
                    <path d="M3 2.5h7l3 3v8H3z M10 2.5v3h3 M5.5 8h5 M5.5 10.5h5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  </svg>
                  {preview === a.file ? 'Close preview' : 'Preview as article'}
                </button>
              </div>
            );
          })}
          {!articles.length && <p className="muted">This ontology folder has no example texts.</p>}
        </div>
        {preview && <ArticleViewer ontologyId={ontologyId} file={preview} onClose={() => setPreview(null)} />}
      </div>

      <div className="source-group">
        <div className="source-head">
          <h4>Your own</h4>
          <span className="muted">Your uploads go to S3 once, under uploads/&lt;run&gt;/. S3 deletes them after a day. Texts must be under 20,000 characters, images under {MAX_IMAGE_MB} MB.</span>
        </div>
        <div className="source-tiles texts">
          {uploads.map((u) => {
            const on = selected.has(u.key);
            return (
              <div key={u.key} className={`source-tile text upload${on ? ' on' : ''}`}>
                <button type="button" className="tile-body" disabled={disabled} onClick={() => onToggle(u.key)} aria-pressed={on}>
                  {u.kind === 'image' ? <img src={u.dataUrl} alt={u.name} /> : <span className="source-kind">your text</span>}
                  <span className="source-title">{u.kind === 'image' ? u.name : u.title}</span>
                  <span className="muted source-meta">{u.kind === 'image' ? `${(u.bytes / 1024).toFixed(0)} KB` : `${u.text.length.toLocaleString()} chars`}</span>
                </button>
                <button type="button" className="small secondary tile-remove" disabled={disabled} onClick={() => onRemoveUpload(u.key)} aria-label={`remove ${u.kind === 'image' ? u.name : u.title}`}>
                  ×
                </button>
              </div>
            );
          })}
          <button type="button" className="source-tile text add" disabled={disabled} onClick={() => fileRef.current?.click()}>
            <span className="source-kind">+ files</span>
            <span className="source-title">Add photos or .md / .txt files</span>
          </button>
          <input ref={fileRef} type="file" multiple hidden disabled={disabled} accept="image/jpeg,image/png,image/webp,image/gif,.md,.txt,text/plain,text/markdown" onChange={(e) => onFiles(e.target.files).then(() => (e.target.value = ''))} />
        </div>
        <UploadNote texts />
        <div className="row add-text">
          <input className="grow" placeholder="Title (optional)" value={title} disabled={disabled} onChange={(e) => setTitle(e.target.value)} aria-label="text title" />
          <textarea rows={2} placeholder="Paste a product description, a social post, an editorial paragraph… (≥ 20 characters)" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} aria-label="text to ingest" />
          <button className="secondary" disabled={disabled || text.trim().length < 20} onClick={addText}>
            Add text
          </button>
        </div>
      </div>
    </div>
  );
}
