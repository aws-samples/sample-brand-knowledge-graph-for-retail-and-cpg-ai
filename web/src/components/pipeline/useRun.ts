// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RunListEntry, type RunStatus, type SourceRequest } from '../../api';
import { useNow } from '../shared/useNow';
import { progressOf } from './runView';

/** The browser remembers the run it watches, so a reload comes back to it (tab 2's step 5 keeps its own: `storageKey`). */
const RUN_KEY = 'oaai.pipeline.run';
const POLL_MS = 2000;

export type StartBody = { ontology_id: string; model_id: string; prompt_caching: boolean; line_id: string; sources: SourceRequest[] };

/**
 * Tab 2's run: start one (`POST /api/pipeline/runs`), poll its records every two seconds while it
 * runs, open a recent one, and, when it finishes, tell the app (`onFinished`: the header counts
 * and the other tabs re-read the graph) and bump `graphVersion` so the batch graph redraws.
 * `runImages` keeps the data URLs of the photos a run was started with, for its thumbnails.
 */
export function useRun(onFinished: () => void, storageKey: string = RUN_KEY) {
  const [runId, setRunId] = useState<string | null>(() => localStorage.getItem(storageKey));
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [recent, setRecent] = useState<RunListEntry[]>([]);
  const [runImages, setRunImages] = useState<Record<string, Record<number, string>>>({});
  const [graphVersion, setGraphVersion] = useState(0);
  const [error, setError] = useState('');
  const wasRunning = useRef(false);

  const listRecent = () => api.listRuns().then((r) => setRecent(r.runs)).catch(() => undefined);
  useEffect(() => {
    listRecent();
  }, []);

  const poll = useCallback(async (id: string) => {
    try {
      const s = await api.runStatus(id);
      setStatus(s);
      setError('');
      return s;
    } catch (e: any) {
      if (e.status === 404) {
        localStorage.removeItem(storageKey);
        setRunId(null);
        setStatus(null);
      } else setError(e.message);
      return null;
    }
  }, [storageKey]);

  useEffect(() => {
    if (!runId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      const s = await poll(runId);
      if (!stopped && s && s.status === 'RUNNING') timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, poll]);

  // when the run finishes: refresh the header counts, redraw the graph, remember the run list
  useEffect(() => {
    const running = status?.status === 'RUNNING';
    if (wasRunning.current && !running && status) {
      onFinished();
      setGraphVersion((v) => v + 1);
      listRecent();
    }
    wasRunning.current = running;
  }, [status, onFinished]);

  const now = useNow(status?.status === 'RUNNING', 1000);

  /** Start a run; `images` are the data URLs of its photo sources by index (for the thumbnails). Resolves to whether it started. */
  async function start(body: StartBody, images: Record<number, string>): Promise<boolean> {
    setStarting(true);
    setError('');
    try {
      const r = await api.startRun(body);
      setRunImages((m) => ({ ...m, [r.run.run_id]: images }));
      setStatus({ run: r.run, status: 'RUNNING', execution: r.execution, records: [], summary: null });
      localStorage.setItem(storageKey, r.run.run_id);
      setRunId(r.run.run_id);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setStarting(false);
    }
  }

  function openRun(id: string) {
    setStatus(null);
    localStorage.setItem(storageKey, id);
    setRunId(id);
  }

  return { status, running: progressOf(status).running, starting, recent, runImages, graphVersion, now, error, start, openRun };
}
