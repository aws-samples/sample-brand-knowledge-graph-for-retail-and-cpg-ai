// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type VisionModel } from '../../api';
import { activeRun, clearRuns, runStore, saveRuns, setActiveRun, subscribe } from './studioCache';
import type { RequestInfo, RunRow, RunState } from './types';
import type { ImageChoice } from './useImageChoice';
import type { OntologyChoice } from './useOntologyChoice';

/**
 * Tab 1's classify calls: one `POST /api/vision/classify` per (ontology, image, model, caching),
 * cached under that key until "Clear results" (studioCache.ts: in memory for the page, finished
 * runs also in sessionStorage, so they outlive a switch to another tab and a reload). `activeKey`
 * is the result shown on the image; `runList` the runs of the current ontology and image,
 * `allRuns` every run of the tab (for the architecture panel). "Run all models" fires every model
 * at once: the Lambda scales out, so wall time is the slowest model, not the sum.
 */
export function useClassification(ontology: OntologyChoice, image: ImageChoice) {
  const runs = useRef<Map<string, RunState>>(runStore());
  const [tick, bump] = useState(0); // bumped whenever a run changes state (runs is a ref)
  // a run that finishes after the tab was left and opened again re-renders the new mount too
  useEffect(() => subscribe(() => bump((v) => v + 1)), []);
  const [activeKey, setActiveKey] = useState(activeRun);
  useEffect(() => setActiveRun(activeKey), [activeKey]);
  const [allRun, setAllRun] = useState<{ total: number; caching: boolean; finished: boolean } | null>(null);

  const keyFor = useCallback((modelId: string, caching: boolean) => `${ontology.key}|${image.hash}|${modelId}|${caching}`, [ontology.key, image.hash]);

  const run = useCallback(
    async (modelId: string, caching: boolean) => {
      const img = image.image;
      if (!img || !modelId) return;
      const key = keyFor(modelId, caching);
      const existing = runs.current.get(key);
      if (existing && existing.status !== 'error') {
        setActiveKey(key);
        return;
      }
      // an example photo of the ontology's own folder is named in the request; anything else travels as bytes
      const useExample = img.kind === 'example' && !ontology.isUpload && img.from === ontology.ontologyId;
      const request: RequestInfo = {
        ontologyId: ontology.key,
        ontologyLabel: ontology.detail?.name ?? ontology.key,
        ontologyUpload: ontology.isUpload,
        ontologyFile: ontology.isUpload ? ontology.upload?.filename ?? '' : ontology.detail?.file ?? '',
        imageLabel: img.kind === 'example' ? img.title : img.name,
        imageUpload: img.kind === 'upload',
        imageBytes: Math.round((img.dataUrl.length - img.dataUrl.indexOf(',') - 1) * 0.75),
        example: useExample ? img.file : null,
        modelId,
        promptCaching: caching,
      };
      const startedAt = Date.now();
      runs.current.set(key, { status: 'running', startedAt, request });
      setActiveKey((cur) => (cur && runs.current.get(cur)?.status === 'running' ? cur : key));
      saveRuns(); // stores the finished runs and re-renders every mount
      try {
        const body: Parameters<typeof api.classify>[0] = { model_id: modelId, prompt_caching: caching };
        if (ontology.isUpload && ontology.upload) {
          body.owl_text = ontology.upload.text;
          body.owl_filename = ontology.upload.filename;
        } else body.ontology_id = ontology.ontologyId;
        if (useExample) body.example = img.file;
        else body.image_base64 = img.dataUrl;
        const result = await api.classify(body);
        runs.current.set(key, { status: 'done', startedAt, finishedAt: Date.now(), request, result });
      } catch (e: any) {
        runs.current.set(key, { status: 'error', startedAt, finishedAt: Date.now(), request, error: e.message });
      }
      saveRuns(); // stores the finished runs and re-renders every mount
    },
    [image.image, keyFor, ontology.key, ontology.isUpload, ontology.ontologyId, ontology.upload, ontology.detail],
  );

  async function runAll(models: VisionModel[], caching: boolean) {
    setAllRun({ total: models.length, caching, finished: false });
    await Promise.all(models.map((m) => run(m.id, caching)));
    setAllRun((s) => (s ? { ...s, finished: true } : s));
    setTimeout(() => setAllRun(null), 1500);
  }

  function rerun(modelId: string, caching: boolean) {
    runs.current.delete(keyFor(modelId, caching));
    run(modelId, caching);
  }

  function clear() {
    clearRuns();
    setActiveKey('');
    setAllRun(null);
  }

  /** A new image: nothing is shown on it until a run is picked. */
  const showNone = () => setActiveKey('');

  const allRuns = useMemo<RunRow[]>(
    () => Array.from(runs.current.entries()).map(([key, state]) => ({ key, state, modelId: key.split('|')[2], caching: key.endsWith('|true') })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );
  const runList = useMemo(() => allRuns.filter((r) => r.key.startsWith(`${ontology.key}|${image.hash}|`)), [allRuns, ontology.key, image.hash]);
  const shown = runs.current.get(activeKey);
  const shownResult = shown?.status === 'done' ? shown.result : null;
  const isRunning = (modelId: string, caching: boolean) => runs.current.get(keyFor(modelId, caching))?.status === 'running';
  const allDone = allRun ? [...runs.current.entries()].filter(([k, s]) => k.startsWith(`${ontology.key}|${image.hash}|`) && k.endsWith(`|${allRun.caching}`) && s.status !== 'running').length : 0;
  const anyRunning = runList.some((r) => r.state.status === 'running');

  return { run, runAll, rerun, clear, showNone, activeKey, setActiveKey, allRuns, runList, shown, shownResult, isRunning, allRun, allDone, anyRunning };
}
