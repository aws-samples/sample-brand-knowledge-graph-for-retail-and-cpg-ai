// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ClassifyResult } from '../../api';

/** What the browser sent, kept with every run so the architecture panel can replay the story. */
export type RequestInfo = {
  ontologyId: string;
  ontologyLabel: string;
  ontologyUpload: boolean;
  ontologyFile: string;
  imageLabel: string;
  imageUpload: boolean;
  imageBytes: number;
  example: string | null;
  modelId: string;
  promptCaching: boolean;
};

export type RunState =
  | { status: 'running'; startedAt: number; request: RequestInfo }
  | { status: 'done'; startedAt: number; finishedAt: number; request: RequestInfo; result: ClassifyResult }
  | { status: 'error'; startedAt: number; finishedAt: number; request: RequestInfo; error: string };

export type RunRow = { key: string; state: RunState; modelId: string; caching: boolean };
