// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The figures of docs/tabs.md, two per tab, rendered into assets/tabs/: the concept behind a tab
 * in the sample's own visual style, and how its steps are built (the AWS services, numbered as the
 * walk-through under the figure). Tab 6 has a second concept figure, the personas and the
 * techniques that answer their questions. The workshop guide shows the same files about 1,000 px
 * wide.
 */
import type { FigureSpec } from '../../kit';
import { tab0Answer } from './tab0-answer';
import { tab0Terms } from './tab0-terms';
import { tab1Concept } from './tab1-concept';
import { tab1Architecture } from './tab1-architecture';
import { tab2Concept } from './tab2-concept';
import { tab2Architecture } from './tab2-architecture';
import { tab3Concept } from './tab3-concept';
import { tab3Architecture } from './tab3-architecture';
import { tab4Concept } from './tab4-concept';
import { tab4Architecture } from './tab4-architecture';
import { tab5Concept } from './tab5-concept';
import { tab5Architecture } from './tab5-architecture';
import { tab6Concept } from './tab6-concept';
import { tab6Personas } from './tab6-personas';
import { tab6Architecture } from './tab6-architecture';

export const TAB_FIGURES: Record<string, FigureSpec> = {
  'tabs/tab0-answer': tab0Answer,
  'tabs/tab0-terms': tab0Terms,
  'tabs/tab1-concept': tab1Concept,
  'tabs/tab1-architecture': tab1Architecture,
  'tabs/tab2-concept': tab2Concept,
  'tabs/tab2-architecture': tab2Architecture,
  'tabs/tab3-concept': tab3Concept,
  'tabs/tab3-architecture': tab3Architecture,
  'tabs/tab4-concept': tab4Concept,
  'tabs/tab4-architecture': tab4Architecture,
  'tabs/tab5-concept': tab5Concept,
  'tabs/tab5-architecture': tab5Architecture,
  'tabs/tab6-concept': tab6Concept,
  'tabs/tab6-personas': tab6Personas,
  'tabs/tab6-architecture': tab6Architecture,
};
