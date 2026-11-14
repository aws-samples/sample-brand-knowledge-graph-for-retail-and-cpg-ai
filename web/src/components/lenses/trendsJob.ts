// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/** How often the browser asks for one of the trends question's agent jobs (the graph agent, the data agent). */
export const POLL_MS = 2000;
/**
 * The API reports a graph agent job that no function finished as failed after 660 s
 * (jobs.FunctionJobs QUEUE_S + RUN_S); the browser waits a minute longer (infra/test/stack.test.ts
 * reads the line below and pins it).
 */
export const POLL_LIMIT_MS = 12 * 60 * 1000;
/** The data agent runs at most 240 s in the lake runtime's microVM; the browser waits 6 minutes. */
export const LAKE_LIMIT_MS = 6 * 60 * 1000;

/** A job as the API returns it: `step` says what it is doing, `result` is there once it is done. */
export type Job<T> = { job_id: string; status: 'running' | 'done' | 'failed'; step?: string; elapsed_s: number; error?: string; result?: T };
export type JobCalls<T, J extends Job<T> = Job<T>> = { start: () => Promise<J>; poll: (jobId: string) => Promise<J> };
export type JobWatch<J = Job<unknown>> = {
  /** What the job is doing, as the API words it. */
  onStep: (step: string) => void;
  /** False once nobody waits any more (the results were cleared, or a new run replaced it): polling stops. */
  alive: () => boolean;
  /** The job as `start` returned it: its id is known from here on. */
  onStarted?: (job: J) => void;
  /** When the job started, for a job picked up again after a reload (the limit counts from here). */
  startedAt?: number;
  limitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Start a background job, then poll it every `POLL_MS` until it is done (resolves with its result)
 * or failed (rejects with its error). Resolves with `null`, without another request, as soon as
 * `alive()` is false. `what` names the work in the errors ("the graph agent"). To pick up a job
 * that is already running, `start` polls it.
 */
export async function runJob<T, J extends Job<T> = Job<T>>(calls: JobCalls<T, J>, watch: JobWatch<J>, what: string): Promise<T | null> {
  const sleep = watch.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = watch.now ?? Date.now;
  const started = watch.startedAt ?? now();
  const limit = watch.limitMs ?? POLL_LIMIT_MS;
  try {
    let job = await calls.start();
    if (watch.alive()) watch.onStarted?.(job);
    while (watch.alive()) {
      if (job.status !== 'running') {
        if (job.status === 'failed' || !job.result) throw new Error(job.error || `${what} failed`);
        return job.result;
      }
      watch.onStep(job.step ?? '');
      if (now() - started > limit) throw new Error(`${what} did not finish within ${limit / 60_000} minutes`);
      await sleep(POLL_MS);
      if (!watch.alive()) break;
      job = await calls.poll(job.job_id);
    }
    return null;
  } catch (e) {
    if (!watch.alive()) return null; // a late error nobody waits for
    throw e;
  }
}
