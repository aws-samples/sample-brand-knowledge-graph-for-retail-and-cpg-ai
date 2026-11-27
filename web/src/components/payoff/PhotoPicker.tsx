// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type ExampleInfo } from '../../api';
import { MAX_IMAGE_MB } from '../../limits';
import { ImageDrop } from '../ImageDrop';
import { UploadNote } from '../shared/UploadNote';

/** The example pieces offered: the domain's single-piece photos (`examples/items/`), like the old style recommendation tab's. */
const MAX_EXAMPLES = 12;

/**
 * Style recommendation's input: a photo of one piece, picked from the domain's example pieces or
 * uploaded. `photo` is a data URL; `onPhoto(null)` clears it.
 */
export function PhotoPicker({ domain, photo, onPhoto, disabled }: { domain: string; photo: string | null; onPhoto: (dataUrl: string | null) => void; disabled: boolean }) {
  const [examples, setExamples] = useState<ExampleInfo[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  // ImageDrop keeps its own preview; a new key clears it when the photo is replaced by an example
  const [dropKey, setDropKey] = useState(0);

  useEffect(() => {
    let live = true;
    setThumbs({});
    setError('');
    api
      .examples(domain, 'items')
      .then((r) => {
        if (!live) return;
        const list = r.examples.slice(0, MAX_EXAMPLES);
        setExamples(list);
        list.forEach((e) =>
          api
            .exampleImage(domain, e.file, 'items')
            .then((img) => live && setThumbs((t) => ({ ...t, [e.file]: img.data_url })))
            .catch(() => undefined),
        );
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [domain]);

  const pickExample = (url: string) => {
    setDropKey((k) => k + 1);
    onPhoto(url);
  };

  return (
    <div className="po-photo-picker">
      <div className="po-photo-main">
        {photo ? <img className="po-photo-chosen" src={photo} alt="the piece you are asking about" /> : <ImageDrop key={dropKey} onImage={(url) => onPhoto(url)} label={`Drop a photo of one piece, or click to choose one (JPEG/PNG/WebP, ≤ ${MAX_IMAGE_MB} MB)`} />}
        {photo && (
          <button type="button" className="small secondary" onClick={() => onPhoto(null)} disabled={disabled}>
            Choose another photo
          </button>
        )}
        <UploadNote />
      </div>
      <div className="po-photo-side">
        <div className="small">Pick an example piece:</div>
        {error && <p className="error small">{error}</p>}
        <div className="photo-examples" role="group" aria-label="example pieces">
          {examples.map((e) =>
            thumbs[e.file] ? (
              <button
                key={e.file}
                type="button"
                className={`photo-example piece${photo === thumbs[e.file] ? ' active' : ''}`}
                onClick={() => pickExample(thumbs[e.file])}
                disabled={disabled}
                title={e.title || e.file}
                aria-pressed={photo === thumbs[e.file]}
              >
                <img src={thumbs[e.file]} alt={e.title || e.file} />
              </button>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
