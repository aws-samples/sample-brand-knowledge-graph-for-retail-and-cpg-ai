// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { WebStorageStateStore } from 'oidc-client-ts';
import { describe, expect, it, vi } from 'vitest';
import { handleCallback, isFramed, managerSettings, onSignInElsewhere, signOut } from './auth';
import type { AppConfig } from './config';

const { config, FakeUserManager } = vi.hoisted(() => {
  const config = {
    region: 'us-east-1',
    userPoolId: 'us-east-1_TestPool1',
    clientId: '1example23456789abcdefghij',
    domain: 'multimodal-ai-knowledge-graph-abcd1234.auth.us-east-1.amazoncognito.com',
    identityPoolId: 'us-east-1:00000000-0000-4000-8000-000000000000',
    apiUrl: 'https://abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-1.on.aws',
  };
  class FakeUserManager {
    static last: FakeUserManager | undefined;
    signoutRedirect = vi.fn(async () => {});
    signinCallback = vi.fn(async () => undefined);
    signinPopupCallback = vi.fn(async () => {});
    constructor(public settings: { client_id: string }) {
      FakeUserManager.last = this;
    }
  }
  return { config, FakeUserManager };
});
const forgetCredentials = vi.hoisted(() => vi.fn());
vi.mock('./config', () => ({ appConfig: async () => config }));
vi.mock('./signing', () => ({ forgetCredentials }));
vi.mock('oidc-client-ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('oidc-client-ts')>()), UserManager: FakeUserManager }));

// A Storage for the user store: enough for the constructor, which only keeps the reference.
const store = { length: 0, clear() {}, getItem: () => null, key: () => null, removeItem() {}, setItem() {} } as Storage;

describe('sign-in with Cognito managed login', () => {
  it('builds the oidc-client-ts settings from /config.json', () => {
    const s = managerSettings(config satisfies AppConfig, 'https://d111.cloudfront.net/', store);
    expect(s.authority).toBe('https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool1');
    expect(s.client_id).toBe('1example23456789abcdefghij');
    expect(s.response_type).toBe('code');
    expect(s.scope).toBe('openid email profile');
    expect(s.redirect_uri).toBe('https://d111.cloudfront.net/');
    expect(s.post_logout_redirect_uri).toBe('https://d111.cloudfront.net/');
    expect(s.automaticSilentRenew).toBe(true);
    expect(s.userStore).toBeInstanceOf(WebStorageStateStore);
    expect(s.metadataSeed).toEqual({ end_session_endpoint: `https://${config.domain}/logout` });
  });

  it('signs out through Cognito /logout with the client id and the allowed sign-out URL', async () => {
    vi.stubGlobal('location', { origin: 'https://d111.cloudfront.net' });
    vi.stubGlobal('sessionStorage', store);
    try {
      await signOut();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(FakeUserManager.last?.signoutRedirect).toHaveBeenCalledWith({
      extraQueryParams: { client_id: '1example23456789abcdefghij', logout_uri: 'https://d111.cloudfront.net/' },
    });
    expect(forgetCredentials).toHaveBeenCalled(); // the API credentials go with the tokens
  });

  it("forgets what the app kept for the user at sign-out (every tab's results, the last pipeline run), not the tokens' store or UI choices", async () => {
    // a Storage whose keys are its own enumerable properties, as the browser's are
    const fake = (entries: Record<string, string>) => {
      const s = { ...entries } as Record<string, unknown>;
      Object.defineProperties(s, {
        getItem: { value: (k: string) => (k in s ? String(s[k]) : null) },
        setItem: { value: (k: string, v: string) => (s[k] = v) },
        removeItem: { value: (k: string) => delete s[k] },
      });
      return s as unknown as Storage;
    };
    const session = fake({
      'studio.runs.v1': '[]',
      'studio.active.v1': '"k"',
      'studio.image.v1.fashion': '{}',
      'kept.stylist.fashion.result': '{}',
      'lens.trends.v1': '{}',
      'oidc.user:https://cognito-idp.example:client': '{}',
    });
    const local = fake({ 'oaai.pipeline.run': 'run-1', 'studio.model': 'global.anthropic.claude-sonnet-5-5' });
    vi.stubGlobal('location', { origin: 'https://d111.cloudfront.net' });
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('localStorage', local);
    try {
      await signOut();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(Object.keys(session)).toEqual(['oidc.user:https://cognito-idp.example:client']);
    expect(Object.keys(local)).toEqual(['studio.model']);
  });

  it('in the popup a framed app opened, hands the response to the opener instead of reading the state', async () => {
    vi.stubGlobal('location', { origin: 'https://d111.cloudfront.net', pathname: '/' });
    vi.stubGlobal('sessionStorage', store);
    vi.stubGlobal('window', { opener: {} });
    try {
      expect(await handleCallback()).toBe('popup');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(FakeUserManager.last?.signinPopupCallback).toHaveBeenCalled();
    expect(FakeUserManager.last?.signinCallback).not.toHaveBeenCalled();
  });

  it('after a redirect sign-in, exchanges the code and drops the parameters from the URL', async () => {
    const replaceState = vi.fn();
    vi.stubGlobal('location', { origin: 'https://d111.cloudfront.net', pathname: '/' });
    vi.stubGlobal('sessionStorage', store);
    vi.stubGlobal('window', { opener: null });
    vi.stubGlobal('history', { replaceState });
    try {
      expect(await handleCallback()).toBe('signed-in');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(FakeUserManager.last?.signinCallback).toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('knows when another page frames it', () => {
    const top = {};
    vi.stubGlobal('window', { self: top, top });
    expect(isFramed()).toBe(false);
    vi.stubGlobal('window', { self: {}, top });
    expect(isFramed()).toBe(true);
    vi.unstubAllGlobals();
  });

  // The test runs in Node: a window that is an EventTarget and a storage event that is a plain Event.
  const storageEvent = (init: { key: string; newValue: string | null; storageArea: unknown }) => Object.assign(new Event('storage'), init);
  const local = { ...store };
  const session = { ...store };

  it('starts a framed app once another frame of the tab has signed in, and only then', () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('sessionStorage', session);
    const then = vi.fn();
    onSignInElsewhere(then);
    window.dispatchEvent(storageEvent({ key: 'oidc.user:https://idp:client', newValue: '{}', storageArea: local }));
    window.dispatchEvent(storageEvent({ key: 'oidc.abc123', newValue: '{}', storageArea: session }));
    window.dispatchEvent(storageEvent({ key: 'oidc.user:https://idp:client', newValue: null, storageArea: session }));
    expect(then).not.toHaveBeenCalled();
    window.dispatchEvent(storageEvent({ key: 'oidc.user:https://idp:client', newValue: '{}', storageArea: session }));
    window.dispatchEvent(storageEvent({ key: 'oidc.user:https://idp:client', newValue: '{}', storageArea: session }));
    expect(then).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('stops listening when asked', () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('sessionStorage', session);
    const then = vi.fn();
    onSignInElsewhere(then)();
    window.dispatchEvent(storageEvent({ key: 'oidc.user:x', newValue: '{}', storageArea: session }));
    expect(then).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
