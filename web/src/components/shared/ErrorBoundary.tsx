// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Keeps a crash in one tab from blanking the whole app: shows what broke and a way to try again.
 * `resetKey` (the open tab) clears the error when the participant moves on.
 */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('This tab crashed while drawing:', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" role="alert">
        <h3>Something on this tab broke while drawing</h3>
        <p className="error">{this.state.error.message}</p>
        <p className="muted small">
          This usually means the page and the API are out of step: restart the API, then try again. The browser console has the details.
        </p>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
