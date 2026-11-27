// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, fileToDataUrl, type ExampleInfo } from '../../api';
import { MAX_IMAGE_BYTES, MAX_IMAGE_MB } from '../../limits';
import { forgetImage, recallImage, rememberImage } from './studioCache';

export type ImageSource =
  | { kind: 'example'; file: string; title: string; dataUrl: string; from: string }
  | { kind: 'upload'; name: string; dataUrl: string };

/**
 * Tab 1's image: one of the domain's example photos (fetched as a data URL) or an upload. `hash`
 * identifies the pixels, so results are cached per image whatever its name; it is computed
 * before the image is set, so both change together. The image is remembered per domain
 * (studioCache.ts): back on tab 1, or after a reload, the same image comes back with the results
 * cached for it, an example photo fetched again by name.
 */
export function useImageChoice(onChange: () => void, domain: string) {
  const [recalled] = useState(() => recallImage(domain));
  const [image, setImage] = useState<ImageSource | null>(recalled.memory?.image ?? null);
  const [hash, setHash] = useState(recalled.memory?.hash ?? '');
  const [loading, setLoading] = useState(!recalled.memory && !!recalled.stored);
  const [error, setError] = useState('');

  function show(next: ImageSource, nextHash: string) {
    setHash(nextHash);
    setImage(next);
    rememberImage(domain, { image: next, hash: nextHash });
  }

  // after a reload: the image sessionStorage names (an example is fetched again), without
  // onChange, so the result shown on it stays selected
  useEffect(() => {
    const stored = recalled.stored;
    if (recalled.memory || !stored) return;
    let live = true;
    (async () => {
      try {
        const dataUrl = stored.kind === 'example' ? (await api.exampleImage(stored.from, stored.file)).data_url : stored.dataUrl;
        const h = await sha16(dataUrl);
        if (live) show(stored.kind === 'example' ? { ...stored, dataUrl } : stored, h);
      } catch {
        forgetImage(domain); // gone from the domain: the tab picks its default photo instead
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickExample(from: string, ex: ExampleInfo) {
    setLoading(true);
    try {
      const r = await api.exampleImage(from, ex.file);
      show({ kind: 'example', file: ex.file, title: ex.title, dataUrl: r.data_url, from }, await sha16(r.data_url));
      setError('');
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onFile(file: File) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return setError('Please upload a JPEG, PNG, WebP or GIF image.');
    if (file.size > MAX_IMAGE_BYTES) return setError(`Please keep images under ${MAX_IMAGE_MB} MB.`);
    const dataUrl = await fileToDataUrl(file);
    show({ kind: 'upload', name: file.name, dataUrl }, await sha16(dataUrl));
    setError('');
    onChange();
  }

  return { image, hash, loading, error, pickExample, onFile };
}

export type ImageChoice = ReturnType<typeof useImageChoice>;

async function sha16(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
