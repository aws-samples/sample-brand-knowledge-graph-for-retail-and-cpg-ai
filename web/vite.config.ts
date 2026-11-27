// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CloudFront serves the SPA; `make build` writes dist/, which the stack publishes. The app calls the
// API's function URL itself (src/signing.ts).
export default defineConfig({
  plugins: [react()],
  // The AWS SDK's credential providers in their browser build (index.browser.js: the Cognito
  // identity providers, no Node ones). Vite does not apply the package's browser field, whose keys
  // have no file extension.
  resolve: { alias: { '@aws-sdk/credential-providers': '@aws-sdk/credential-providers/dist-es/index.browser.js' } },
  build: { outDir: 'dist', sourcemap: false },
  // Unit tests for the pure modules (layout geometry); the UI itself is smoke-tested in a browser.
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node' },
});
