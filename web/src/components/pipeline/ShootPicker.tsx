// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ExampleInfo } from '../../api';
import { occasionLabel } from './useSources';

/**
 * Step 2 of tab 2: the brand's new shoot, one tile per look with its occasion. Every tile toggles
 * (keys `img:<file>`, as the rest of the batch); all of them start selected.
 */
export function ShootPicker({
  shoot,
  thumbs,
  selected,
  disabled,
  onToggle,
  onSelectAll,
}: {
  shoot: ExampleInfo[];
  thumbs: Record<string, string>;
  selected: Set<string>;
  disabled: boolean;
  onToggle: (key: string) => void;
  onSelectAll: (keys: string[], on: boolean) => void;
}) {
  const keys = shoot.map((e) => `img:${e.file}`);
  const picked = keys.filter((k) => selected.has(k)).length;
  const all = picked === keys.length;
  return (
    <div className="shoot">
      <div className="row shoot-head">
        <b>
          {picked} of {shoot.length} looks selected
        </b>
        <button className="small secondary" disabled={disabled} onClick={() => onSelectAll(keys, !all)}>
          {all ? 'Select none' : 'Select all'}
        </button>
      </div>
      <div className="source-tiles">
        {shoot.map((e) => {
          const key = `img:${e.file}`;
          const on = selected.has(key);
          return (
            <button key={key} type="button" className={`source-tile${on ? ' on' : ''}`} disabled={disabled} onClick={() => onToggle(key)} aria-pressed={on} title={e.file}>
              {thumbs[e.file] ? <img src={thumbs[e.file]} alt={e.title} /> : <div className="thumb-placeholder muted">loading…</div>}
              {e.occasion && <span className="source-kind">{occasionLabel(e.occasion)}</span>}
              <span className="source-title">{e.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
