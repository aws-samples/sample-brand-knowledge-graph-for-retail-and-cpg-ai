// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type Architecture } from '../../api';

/** `GET /api/explorer/architecture` (where the API runs, its buckets, the console links), read once the panel opens. */
export function useArchitecture(open: boolean): { arch: Architecture | null; error: string } {
  const [arch, setArch] = useState<Architecture | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || arch) return;
    api
      .architecture()
      .then(setArch)
      .catch((e) => setError(e.message));
  }, [open, arch]);
  return { arch, error };
}
