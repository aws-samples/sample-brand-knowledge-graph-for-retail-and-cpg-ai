// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../kit';
import { architecture } from './architecture';
import { dataLayout } from './data-layout';
import { graphModel } from './graph-model';
import { ingest } from './ingest';
import { ragVsGraphrag } from './rag-vs-graphrag';

export const FIGURES: Record<string, FigureSpec> = {
  architecture,
  'ingest-pipeline': ingest,
  'rag-vs-graphrag': ragVsGraphrag,
  'graph-model': graphModel,
  'data-layout': dataLayout,
};
