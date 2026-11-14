// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type SetupStatus } from '../../api';

/** Tab 0's one round trip: `GET /api/setup`, read once when the section opens. */
export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.setup().then(
      (s) => setStatus(s),
      (e: any) => setError(e.message),
    );
  }, []);
  return { status, error };
}
