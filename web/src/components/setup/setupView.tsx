// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { AgentSetup, SetupStatus } from '../../api';

/** What tab 0's cards share: the pills, the labels, the console links and the pure helper its test covers. */

const HOST_LABEL = { agentcore: 'AgentCore Runtime', 'in-process': 'in the API process' } as const;

/** The AgentCore console page of one runtime, from its ARN (…:runtime/<id>). */
export const agentRuntimeConsoleUrl = (region: string, arn: string) => `https://${region}.console.aws.amazon.com/bedrock-agentcore/agents/${arn.split('/').pop()}`;
/** The S3 console page of one vector bucket. */
export const vectorBucketConsoleUrl = (region: string, bucket: string) => `https://${region}.console.aws.amazon.com/s3/vectors/bucket/${encodeURIComponent(bucket)}?region=${region}`;

/** The Amazon Bedrock console's guardrails page. */
export const guardrailsConsoleUrl = (region: string) => `https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/guardrails`;
/** `optional`: a resource the sample works without, so "not set up" is a neutral state, not a warning. */
export function ReadyPill({ ok, optional = false }: { ok: boolean; optional?: boolean }) {
  return <span className={`setup-pill ${ok ? 'ok' : optional ? 'off' : 'todo'}`}>{ok ? 'ready' : 'not set up'}</span>;
}

export function AgentPill({ ag }: { ag: AgentSetup }) {
  return <span className={`setup-pill ${ag.available ? 'ok' : 'off'}`}>{ag.available && ag.host ? HOST_LABEL[ag.host] : 'off'}</span>;
}

export function roleLabel(role: string) {
  return { embedding: 'embeddings (tabs 2, 4 to 6)', vision: 'classification (tabs 1 and 2)', answer: 'answers and agents (tabs 0, 3 to 6)' }[role] ?? role;
}

/** The models the deployment uses, each once, with every role it has. */
export function modelRows(s: SetupStatus) {
  const roles = new Map<string, Set<string>>([[s.models.embedding, new Set(['embedding'])]]);
  for (const id of s.models.vision) roles.set(id, new Set([...(roles.get(id) ?? []), 'vision']));
  for (const id of s.models.answer) roles.set(id, new Set([...(roles.get(id) ?? []), 'answer']));
  return [...roles.entries()].map(([id, r]) => ({ id, roles: [...r].sort() }));
}
