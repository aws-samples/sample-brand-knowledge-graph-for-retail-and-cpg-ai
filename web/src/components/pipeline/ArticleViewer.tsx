// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useRef, useState } from 'react';
import { api, type ArticleInfo } from '../../api';
import { parseArticle, type Article, type Block, type Inline } from './articleMarkdown';

/**
 * A blog-style preview of one example text, shown inline in the ingest tab, right under the example
 * texts (no overlay, no new tab): the close button or Esc folds it away again. It shows the text the
 * way a reader would meet it (masthead, headline, byline, the paired photo, body and hashtags),
 * while the pipeline itself only ever reads the raw Markdown (shown at the bottom).
 */
type Loaded = { meta?: ArticleInfo; text: string; article: Article; photo?: string };

async function loadArticle(ontologyId: string, file: string): Promise<Loaded> {
  const [{ articles }, { text }] = await Promise.all([api.articles(ontologyId), api.articleText(ontologyId, file)]);
  const meta = articles.find((a) => a.file === file);
  const photo = meta?.pairs_with_image ? (await api.exampleImage(ontologyId, meta.pairs_with_image)).data_url : undefined;
  return { meta, text, article: parseArticle(text), photo };
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const ARTICLE_PREVIEW_ID = 'article-preview';

/** `id`: the panel's element id, for the `aria-controls` of the link that opens it; each list that opens previews (the sources, the batch, the article step) passes its own. */
export function ArticleViewer({ ontologyId, file, onClose, id = ARTICLE_PREVIEW_ID }: { ontologyId: string; file: string; onClose: () => void; id?: string }) {
  const panel = useRef<HTMLElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Esc closes the preview from anywhere on the page while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // Bring the preview into view (and keyboard focus into it) whenever another text is opened.
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.current?.focus({ preventScroll: true });
  }, [file]);
  useEffect(() => {
    setLoaded(null);
    setError('');
    loadArticle(ontologyId, file)
      .then(setLoaded)
      .catch((e: Error) => setError(e.message));
  }, [ontologyId, file]);

  const source = loaded ? loaded.meta?.source || loaded.article.byline.split('·')[0]?.trim() || 'Example text' : '';
  return (
    <section
      ref={panel}
      id={id}
      className="blog-inline"
      tabIndex={-1}
      aria-label={loaded ? `article preview: ${loaded.meta?.title || loaded.article.title}` : 'article preview'}
    >
      <div className="blog">
        <header className="blog-top">
          <span className="blog-masthead">{source || '…'}</span>
          <span className="blog-note">Synthetic example · fictional brand · preview</span>
          <button type="button" className="small secondary blog-close" onClick={onClose} aria-label="close the preview">
            ✕ Close
          </button>
        </header>
        {error && <p className="error blog-loading" role="alert">Could not load {file}: {error}</p>}
        {!loaded && !error && <p className="muted blog-loading" role="status">Loading the article…</p>}
        {loaded && <ArticleBody loaded={loaded} source={source} file={file} ontologyId={ontologyId} />}
      </div>
    </section>
  );
}

function ArticleBody({ loaded, source, file, ontologyId }: { loaded: Loaded; source: string; file: string; ontologyId: string }) {
  const { meta, article, photo, text } = loaded;
  const minutes = Math.max(1, Math.round(article.words / 200));
  return (
    <>
      <article className="blog-article">
        {meta?.kind && <span className="blog-kind">{meta.kind}</span>}
        <h1>{meta?.title || article.title}</h1>
        <p className="blog-byline">
          By <b>{source}</b>
          {meta?.published && <> · {longDate(meta.published)}</>} · {minutes} min read
        </p>
        {photo && (
          <figure className="blog-hero">
            <img src={photo} alt={meta?.title || article.title} />
            <figcaption>The example photo this text pairs with ({meta?.pairs_with_image}).</figcaption>
          </figure>
        )}
        <div className="blog-body">
          {article.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
        {article.tags.length > 0 && (
          <p className="blog-tags">
            {article.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </p>
        )}
      </article>
      <footer className="blog-foot">
        <p>
          This page is only a preview. The ingest pipeline sends the raw text below to the model, together with the ontology prompt. The text is <code>{`${ontologyId}/${meta?.data_set ? `datasets/${meta.data_set}/` : ''}examples/articles/${file}`}</code> ({text.length.toLocaleString()} characters).
        </p>
        <details>
          <summary>Raw Markdown</summary>
          <pre>{text}</pre>
        </details>
      </footer>
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? <h2><Spans spans={block.text} /></h2> : <h3><Spans spans={block.text} /></h3>;
    case 'quote':
      return <blockquote><Spans spans={block.text} /></blockquote>;
    case 'list':
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}><Spans spans={item} /></li>
          ))}
        </ul>
      );
    case 'paragraph':
      return <p><Spans spans={block.text} /></p>;
  }
}

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === 'bold') return <strong key={i}>{s.text}</strong>;
        if (s.kind === 'italic') return <em key={i}>{s.text}</em>;
        if (s.kind === 'tag') return <span key={i} className="blog-tag">#{s.text}</span>;
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}
