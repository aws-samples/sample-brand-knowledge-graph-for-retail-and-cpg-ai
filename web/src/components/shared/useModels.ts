// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type VisionModel } from '../../api';
import { useStoredChoice } from './useStoredChoice';

/**
 * The two model catalogs the API offers: the vision models that classify a photo or a text
 * (tabs 1 to 4) and the answer models that write answers, plan queries and explain
 * trends (tabs 2, 3 and 4). Each is fetched once per page and shared by every tab and select.
 */
export type ModelKind = 'vision' | 'answer';
export type Catalog = { models: VisionModel[]; defaultId: string };

const EMPTY: Catalog = { models: [], defaultId: '' };
const cache: Partial<Record<ModelKind, Promise<Catalog>>> = {};

function catalog(kind: ModelKind): Promise<Catalog> {
  cache[kind] ??= (kind === 'vision' ? api.visionModels().then((r) => ({ models: r.models, defaultId: r.models[0]?.id ?? '' })) : api.askModels().then((r) => ({ models: r.models, defaultId: r.default }))).catch((e) => {
    delete cache[kind]; // the next mount tries again
    throw e;
  });
  return cache[kind];
}

export function useModels(kind: ModelKind): Catalog & { error: string } {
  const [state, setState] = useState<Catalog & { error: string }>({ ...EMPTY, error: '' });
  useEffect(() => {
    let mounted = true;
    catalog(kind)
      .then((c) => mounted && setState({ ...c, error: '' }))
      .catch((e) => mounted && setState({ ...EMPTY, error: e.message }));
    return () => {
      mounted = false;
    };
  }, [kind]);
  return state;
}

/**
 * The model a tab works with: remembered under `key` when given, taken from the catalog's
 * default when nothing (valid) is remembered. `models` is the catalog, for names and notes.
 */
export function useModelChoice(kind: ModelKind, key: string | null = null): { models: VisionModel[]; modelId: string; setModelId: (id: string) => void; error: string } {
  const { models, defaultId, error } = useModels(kind);
  const [wanted, setModelId] = useStoredChoice(key, '');
  const modelId = models.some((m) => m.id === wanted) ? wanted : defaultId;
  return { models, modelId, setModelId, error };
}
