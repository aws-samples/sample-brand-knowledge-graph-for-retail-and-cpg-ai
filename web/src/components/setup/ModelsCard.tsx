// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type SetupStatus } from '../../api';
import { modelRows, roleLabel } from './setupView';

/** The Amazon Bedrock models the deployment uses, by role. */
export function ModelsCard({ s }: { s: SetupStatus }) {
  // Readable names for the IDs (the vision list has them).
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    api.visionModels().then((r) => setNames(Object.fromEntries(r.models.map((m) => [m.id, m.name]))), () => undefined);
  }, []);
  // One group per "used by", so the shared role line is shown once instead of on every row.
  const groups = new Map<string, ReturnType<typeof modelRows>>();
  for (const m of modelRows(s)) {
    const key = m.roles.map(roleLabel).join(', ');
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return (
    <section className="card setup-card">
      <h3>Amazon Bedrock models</h3>
      <p className="muted">
        The account needs access to these models in {s.region}, through cross-Region inference profiles where they exist. The stack&apos;s roles can call these
        models and no others. Run <code>ontology-rag check-models</code> before a deploy to check access.
      </p>
      <table className="results setup-models">
        <thead>
          <tr>
            <th>Model</th>
          </tr>
        </thead>
        {[...groups.entries()].map(([usedBy, rows]) => (
          <tbody key={usedBy}>
            <tr className="group">
              <th scope="colgroup">Used for {usedBy}</th>
            </tr>
            {rows.map((m) => {
              const name = names[m.id] ?? '';
              return (
                <tr key={m.id}>
                  <td>
                    {name ? (
                      <>
                        <span className="model-name">{name}</span> <code className="model-id">{m.id}</code>
                      </>
                    ) : (
                      <code>{m.id}</code>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </section>
  );
}
