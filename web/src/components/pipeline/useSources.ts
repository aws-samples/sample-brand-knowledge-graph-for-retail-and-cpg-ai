// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useRef, useState } from 'react';
import { api, type OntologyDetail, type SourceRequest } from '../../api';
import { withoutNewWork } from '../../domain';
import type { Upload } from './SourcePicker';

/** The batch of example photos tab 2 is about: the brand's new shoot (`batch` in the manifest). */
export const SHOOT = 'new-shoot';
/** A domain without a new shoot starts with the photos and texts its manifests mark with this batch. */
export const FIRST = 'first';

/** `business_casual` -> "Business casual". */
export function occasionLabel(slug: string): string {
  const s = slug.replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/**
 * The keys tab 2 selects when a domain opens: its new shoot when it has one; else the photos and
 * texts its manifests mark `"batch": "first"`; else three texts and the photos they describe (or
 * three photos when it has no texts).
 */
export function defaultBatch(detail: Pick<OntologyDetail, 'examples_list' | 'articles_list'>): Set<string> {
  const shoot = detail.examples_list.filter((e) => e.batch === SHOOT);
  if (shoot.length) return new Set(shoot.map((e) => `img:${e.file}`));
  const first = [...detail.examples_list.filter((e) => e.batch === FIRST).map((e) => `img:${e.file}`), ...detail.articles_list.filter((a) => a.batch === FIRST).map((a) => `txt:${a.file}`)];
  if (first.length) return new Set(first);
  const texts = detail.articles_list.slice(0, 3);
  const keys = new Set<string>(texts.map((a) => `txt:${a.file}`));
  texts.forEach((a) => a.pairs_with_image && keys.add(`img:${a.pairs_with_image}`));
  if (!keys.size) withoutNewWork(detail.examples_list).slice(0, 3).forEach((e) => keys.add(`img:${e.file}`));
  return keys;
}

/**
 * The batch of tab 2: the domain's example photos and texts (`detail`, with the photos'
 * thumbnails fetched once as data URLs), the user's uploads, and which of them are selected
 * (keys `img:<file>`, `txt:<file>`, `up:<id>`). A domain starts with `defaultBatch`.
 */
export function useSources(domain: string) {
  const [detail, setDetail] = useState<OntologyDetail | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const defaulted = useRef(false);

  useEffect(() => {
    // a response for a domain the user has left is dropped (live)
    let live = true;
    setDetail(null);
    setThumbs({});
    defaulted.current = false;
    api
      .ontologyDetail(domain)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        // the new work is tab 6's: never offered here, so no thumbnail either
        const offered = withoutNewWork(d.examples_list);
        offered.forEach((e) =>
          api
            .exampleImage(domain, e.file)
            .then((img) => live && setThumbs((t) => ({ ...t, [e.file]: img.data_url })))
            .catch(() => undefined),
        );
        if (defaulted.current) return;
        defaulted.current = true;
        setSelected(defaultBatch(d));
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [domain]);

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const selectAll = (keys: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
      return n;
    });
  const addUploads = (us: Upload[]) => {
    setUploads((u) => [...u, ...us]);
    setSelected((s) => new Set([...s, ...us.map((u) => u.key)]));
  };
  const removeUpload = (key: string) => {
    setUploads((u) => u.filter((x) => x.key !== key));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
  };

  /** The selected sources as the API takes them (examples by name, uploads with their bytes), and the photos' data URLs by index. */
  function requests(): { sources: SourceRequest[]; images: Record<number, string> } {
    const sources: SourceRequest[] = [];
    const images: Record<number, string> = {};
    for (const key of Array.from(selected)) {
      if (key.startsWith('img:')) {
        const file = key.slice(4);
        images[sources.length] = thumbs[file];
        sources.push({ kind: 'image', example: file });
      } else if (key.startsWith('txt:')) {
        sources.push({ kind: 'text', example: key.slice(4) });
      } else {
        const u = uploads.find((x) => x.key === key);
        if (!u) continue;
        if (u.kind === 'image') {
          images[sources.length] = u.dataUrl;
          sources.push({ kind: 'image', image_base64: u.dataUrl, name: u.name });
        } else sources.push({ kind: 'text', title: u.title, text: u.text, source: 'workshop' });
      }
    }
    return { sources, images };
  }

  return { detail, thumbs, uploads, selected, error, toggle, selectAll, addUploads, removeUpload, requests };
}
