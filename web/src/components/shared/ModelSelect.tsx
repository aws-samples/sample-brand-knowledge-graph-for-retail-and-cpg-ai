// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { CSSProperties } from 'react';
import { useModels, type ModelKind } from './useModels';

/**
 * The model dropdown every tab has: one of the API's catalogs (`kind`), the chosen id and, where
 * caching matters (tabs 1 and 2), which models cache the ontology prompt explicitly.
 */
export function ModelSelect({
  id,
  label,
  kind,
  value,
  onChange,
  disabled = false,
  cacheNote = false,
  className = '',
  style,
}: {
  id: string;
  label: string;
  kind: ModelKind;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  cacheNote?: boolean;
  /** Extra classes of the surrounding field (the toolbar's `grow-*`). */
  className?: string;
  style?: CSSProperties;
}) {
  const { models } = useModels(kind);
  return (
    <div className={`field ${className}`.trim()} style={style}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {cacheNote && m.explicit_cache ? ' · explicit cache' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
