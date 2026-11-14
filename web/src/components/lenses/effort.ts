// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Reasoning, VisionModel } from '../../api';

/**
 * The reasoning effort of the trends question's agents (methods 1 and 2): which levels a model
 * offers (`reasoning.levels` from GET /api/ask/models), how each reads on screen, and what the
 * browser sends. Wire ids are lower-case (`default`, `off`, `low`, `medium`, `high`); `default`
 * leaves the model at its own level (`default_means`).
 */
const LABEL: Record<string, string> = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };

/** "Default (high)", "Off", "Low", "Medium", "High". */
export function effortLabel(id: string, reasoning: Reasoning | null | undefined): string {
  if (id === 'default') return reasoning ? `Default (${reasoning.default_means})` : 'Default';
  return LABEL[id] ?? id;
}

/** The choices of the "Reasoning effort" control, in the order the model lists them; none for a model with no setting. */
export function effortOptions(model: VisionModel | undefined): { id: string; label: string }[] {
  return model?.reasoning ? model.reasoning.levels.map((id) => ({ id, label: effortLabel(id, model.reasoning) })) : [];
}

/**
 * The effort to send: the remembered one if the model offers it, else the model's `default`;
 * null for a model with no setting (the request then carries none).
 */
export function effortFor(model: VisionModel | undefined, wanted: string): string | null {
  if (!model?.reasoning) return null;
  return model.reasoning.levels.includes(wanted) ? wanted : 'default';
}

/** A result's effort as the metrics line and the scoreboard show it ("Default (high)", "Low", "not set"). */
export function effortText(effort: string | null | undefined, model: VisionModel | undefined): string {
  return effort ? effortLabel(effort, model?.reasoning) : 'not set';
}
