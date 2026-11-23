// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type VisionModel } from '../../api';
import { UploadNote } from '../shared/UploadNote';
import type { useClassification } from './useClassification';
import type { ImageChoice } from './useImageChoice';
import type { OntologyChoice } from './useOntologyChoice';


type Runs = ReturnType<typeof useClassification>;

/** Whether Classify can be pressed: a photo, a model and a parsed ontology. */
function canClassify(ontology: OntologyChoice, image: ImageChoice, modelId: string) {
  return !!image.image && !!image.hash && !!modelId && !!ontology.detail && !ontology.loading && !image.loading;
}

// the example photos' thumbnails, fetched once per page (`<domain>/<file>` → data URL)
const thumbCache: Record<string, string> = {};

/** The domain's example photos as data URLs, fetched once (the API client queues photo requests). */
function useThumbs(from: string, files: string[]) {
  const [thumbs, setThumbs] = useState<Record<string, string>>(() => ({ ...thumbCache }));
  const key = files.join('|');
  useEffect(() => {
    let live = true;
    for (const file of files) {
      const k = `${from}/${file}`;
      if (thumbCache[k]) continue;
      api.exampleImage(from, file).then(
        (r) => {
          thumbCache[k] = r.data_url;
          if (live) setThumbs((t) => ({ ...t, [k]: r.data_url }));
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, key]);
  return (file: string) => thumbs[`${from}/${file}`];
}

/**
 * Step 2's controls: the photo, as a strip of the domain's example photos (click one) with an
 * upload tile at the end (what may be uploaded is the tile's title and a note only screen readers
 * get); then the vision model, one button per model (a check on those already
 * run on this photo: picking one shows its kept answer), and Classify.
 */
export function PhotoBar({
  ontology,
  image,
  runs,
  models,
  modelId,
  onModel,
  promptCaching,
}: {
  ontology: OntologyChoice;
  image: ImageChoice;
  runs: Runs;
  models: VisionModel[];
  modelId: string;
  onModel: (id: string) => void;
  promptCaching: boolean;
}) {
  const { examples } = ontology;
  const img = image.image;
  const classifying = runs.isRunning(modelId, promptCaching);
  const canRun = canClassify(ontology, image, modelId);
  const thumbOf = useThumbs(examples.from, examples.list.map((e) => e.file));
  const chosen = img?.kind === 'example' && img.from === examples.from ? img.file : null;
  const keptRun = (id: string) => runs.runList.find((r) => r.modelId === id && r.caching === promptCaching && r.state.status === 'done');
  const pickModel = (id: string) => {
    onModel(id);
    const kept = keptRun(id);
    if (kept) runs.setActiveKey(kept.key); // its answer was kept: show it at once
  };
  return (
    <>
      <div className="po-sec-label">Pick a photo</div>
      <div className="photo-strip" role="listbox" aria-label="example photos">
        {examples.list.map((ex) => {
          const on = chosen === ex.file;
          const src = thumbOf(ex.file);
          return (
            <button
              key={ex.file}
              type="button"
              role="option"
              aria-selected={on}
              className={`photo-tile${on ? ' on' : ''}`}
              disabled={image.loading || classifying}
              onClick={() => !on && image.pickExample(examples.from, ex)}
              title={`${ex.title} (${ex.file})`}
            >
              {src ? <img src={src} alt={ex.title} /> : <span className="photo-tile-wait muted small">loading…</span>}
            </button>
          );
        })}
        <button
          type="button"
          className={`photo-tile photo-tile-upload${img?.kind === 'upload' ? ' on' : ''}`}
          disabled={classifying}
          onClick={() => document.getElementById('img-file')?.click()}
          title="Upload your own photo of clothing (no identifiable people, no personal or confidential information)"
          aria-describedby="studio-upload-note"
        >
          {img?.kind === 'upload' ? <img src={img.dataUrl} alt={img.name} /> : <span>+ your own photo</span>}
        </button>
        <input id="img-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && image.onFile(e.target.files[0])} />
      </div>
      <UploadNote hidden id="studio-upload-note" />
      <div className="po-sec-label">Pick a vision model</div>
      <div className="model-buttons" role="radiogroup" aria-label="vision model">
        {models.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={m.id === modelId} className={`small${m.id === modelId ? '' : ' secondary'}`} onClick={() => pickModel(m.id)} title={m.notes || m.provider}>
            {m.name}
            {keptRun(m.id) && (
              <span className="done-mark" aria-label="answered">
                ✓
              </span>
            )}
          </button>
        ))}
        <span className="spacer" style={{ flex: '1 1 auto' }} />
        <button disabled={!canRun || classifying} onClick={() => runs.run(modelId, promptCaching)} className={classifying ? 'busy' : ''}>
          {classifying ? (
            <>
              <span className="spinner light" /> Classifying…
            </>
          ) : (
            'Classify'
          )}
        </button>
      </div>
      <p className="muted small" style={{ margin: '0.35rem 0 0.6rem' }}>
        Try the same photo with another model. Each answer is kept (✓), so you can switch back.
      </p>
    </>
  );
}
