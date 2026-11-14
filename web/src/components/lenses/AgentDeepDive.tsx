// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { VisionModel } from '../../api';
import { ModelSelect } from '../shared/ModelSelect';
import { useModelChoice } from '../shared/useModels';
import { useStoredChoice } from '../shared/useStoredChoice';
import type { AgentMethodId } from './trendsCache';
import { effortFor, effortOptions } from './effort';

/**
 * The model and reasoning effort a trends agent works with, remembered per method in local
 * storage (`lens.trends.<method>.model`, `.effort`). Choosing a model that does not offer the
 * remembered effort falls back to its `default`; `effort` is what is sent (null for a model with
 * no setting).
 */
export function useAgentChoice(method: AgentMethodId) {
  const { models, modelId, setModelId } = useModelChoice('answer', `lens.trends.${method}.model`);
  const [wanted, setEffort] = useStoredChoice(`lens.trends.${method}.effort`, 'default');
  const model = models.find((m) => m.id === modelId);
  const chooseModel = (id: string) => {
    setModelId(id);
    const next = models.find((m) => m.id === id);
    if (next?.reasoning && !next.reasoning.levels.includes(wanted)) setEffort('default');
  };
  return { models, model, modelId, setModelId: chooseModel, effort: effortFor(model, wanted), setEffort };
}

/**
 * "Deep dive: the agent's model and reasoning effort" (methods 1 and 2, collapsed): the agent's
 * model (the answer models) and the effort levels that model offers, or its sentence when it has
 * no setting.
 */
export function AgentDeepDive({
  id,
  model,
  modelId,
  effort,
  onModel,
  onEffort,
  disabled,
}: {
  id: string;
  model: VisionModel | undefined;
  modelId: string;
  effort: string | null;
  onModel: (id: string) => void;
  onEffort: (effort: string) => void;
  disabled: boolean;
}) {
  const options = effortOptions(model);
  return (
    <details className="xp">
      <summary>
        Deep dive: the agent&apos;s model and reasoning effort<span className="xp-hint">{model ? `${model.name}${effort ? ` · ${options.find((o) => o.id === effort)?.label ?? effort}` : ''}` : ''}</span>
      </summary>
      <div className="row ln-deep-dive">
        <ModelSelect id={`${id}-model`} label="Agent model" kind="answer" value={modelId} onChange={onModel} disabled={disabled} style={{ flex: '0 1 300px' }} />
        {model?.reasoning ? (
          <div className="field" style={{ flex: '0 1 220px' }}>
            <label htmlFor={`${id}-effort`}>Reasoning effort</label>
            <select id={`${id}-effort`} value={effort ?? 'default'} onChange={(e) => onEffort(e.target.value)} disabled={disabled}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : model?.reasoning_note ? (
          <p className="muted small ln-effort-note">{model.reasoning_note}</p>
        ) : null}
      </div>
      <p className="muted small">
        The agent sends the effort with every model turn. More effort means more reasoning before each tool call: slower turns and more output tokens. Every level keeps the same budget of
        4,096 output tokens per turn, so a turn that reasons too long stops at <code>max_tokens</code>, and the trace shows it.
      </p>
    </details>
  );
}

/** "Deep dive: the model that describes the cloud" (method 3): one model for its two describe calls, remembered in `lens.trends.describe.model`. */
export function DescribeDeepDive({ modelId, onModel, disabled }: { modelId: string; onModel: (id: string) => void; disabled: boolean }) {
  return (
    <details className="xp">
      <summary>Deep dive: the model that describes the cloud</summary>
      <div className="row ln-deep-dive">
        <ModelSelect id="ln-trends-describe-model" label="Model" kind="answer" value={modelId} onChange={onModel} disabled={disabled} style={{ flex: '0 1 300px' }} />
      </div>
      <p className="muted small">Describe makes two fixed model calls side by side, the pieces and their looks, not an agent loop: there is no reasoning effort to set here.</p>
    </details>
  );
}
