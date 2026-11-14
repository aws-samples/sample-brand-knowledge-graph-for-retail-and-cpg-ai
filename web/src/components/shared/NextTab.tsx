// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createContext, useContext, type ReactNode } from 'react';
import { TABS, type Tab } from '../../tabs';

/** How a tab opens another one (App provides it: the same as clicking the tab bar). */
export const OpenTabContext = createContext<(t: Tab) => void>(() => undefined);

/**
 * The last card of a tab: a line or two about what comes next, and a button that opens it (the
 * same card at the bottom of every tab). `to` is the tab to open; the button says `lead` and its label.
 */
export function NextTab({ to, lead = 'Next:', children }: { to: Tab; lead?: string; children: ReactNode }) {
  const openTab = useContext(OpenTabContext);
  const label = TABS.find((t) => t.id === to)?.label ?? to;
  return (
    <div className="card start-begin next-tab">
      <div>{children}</div>
      <button
        onClick={() => {
          openTab(to);
          window.scrollTo({ top: 0 });
        }}
      >
        {lead} {label} →
      </button>
    </div>
  );
}
