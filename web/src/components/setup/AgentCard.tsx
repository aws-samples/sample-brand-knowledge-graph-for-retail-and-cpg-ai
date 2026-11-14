// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { SetupStatus } from '../../api';
import { AgentPill, agentRuntimeConsoleUrl } from './setupView';

/** Tab 3's query agent on Amazon Bedrock AgentCore Runtime: the runtime the API invokes, and its console link. */
export function AgentCard({ s }: { s: SetupStatus }) {
  const ag = s.agent;
  const runtimeConsole = ag.runtime_arn ? agentRuntimeConsoleUrl(s.region, ag.runtime_arn) : null;
  return (
    <section className="card setup-card">
      <h3>
        Query agent: Amazon Bedrock AgentCore Runtime <AgentPill ag={ag} />
      </h3>
      <p className="muted">
        When Neptune rejects a query, or when you ask a question in plain words, tab 3 hands it to an agent. The agent calls the Amazon Neptune MCP server in a Converse tool loop. It runs on
        AgentCore Runtime: one microVM per browser session, with a role that can only read the graph and call the models.
      </p>
      <p>
        {ag.runtime_arn ? (
          <>
            The API invokes <code className="wrap">{ag.runtime_arn}</code>. It may call <code>bedrock-agentcore:InvokeAgentRuntime</code> and nothing else.
          </>
        ) : (
          <>No runtime is configured: {ag.reason}</>
        )}
      </p>
      {runtimeConsole && (
        <div className="setup-actions">
          <a className="button-link" href={runtimeConsole} target="_blank" rel="noopener noreferrer">
            AgentCore runtime console ↗
          </a>
        </div>
      )}
    </section>
  );
}
