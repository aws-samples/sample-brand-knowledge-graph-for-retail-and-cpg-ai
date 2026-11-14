// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Where tab 4 keeps its question and stages (shared/kept.ts), per domain. Stages 1 to 5 work on
 * the question: a new question forgets everything under `stagesOf(domain)`. Stage 1's "done" and
 * stage 6, which has its own question, stay.
 */
export const tabKey = (domain: string, part: string) => `retriever.${domain}.${part}`;
export const stagesOf = (domain: string) => tabKey(domain, 'stage.');
export const stageKey = (domain: string, part: string) => stagesOf(domain) + part;
