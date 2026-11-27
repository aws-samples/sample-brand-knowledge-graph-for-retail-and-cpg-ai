// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useState } from 'react';

/**
 * A choice the browser remembers across reloads (the model of a tab, a checkbox, the domain):
 * read from localStorage under `key` once, written back on every change. `null` for a choice
 * that is not remembered (plain state).
 */
export function useStoredChoice(key: string | null, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => (key && localStorage.getItem(key)) || fallback);
  const choose = useCallback(
    (next: string) => {
      setValue(next);
      if (key) localStorage.setItem(key, next);
    },
    [key],
  );
  return [value, choose];
}

/** A remembered on/off switch (stored as "true" / "false"). */
export function useStoredFlag(key: string, fallback: boolean): [boolean, (on: boolean) => void] {
  const [value, choose] = useStoredChoice(key, String(fallback));
  return [value === 'true', useCallback((on: boolean) => choose(String(on)), [choose])];
}
