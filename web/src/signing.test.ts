// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiCredentials, forgetCredentials, signedRequest } from './signing';

const CONFIG = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_TestPool1',
  clientId: '1example23456789abcdefghij',
  domain: 'multimodal-ai-knowledge-graph-abcd1234.auth.us-east-1.amazoncognito.com',
  identityPoolId: 'us-east-1:00000000-0000-4000-8000-000000000000',
  apiUrl: 'https://abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-1.on.aws',
};
const state = vi.hoisted(() => ({ idToken: 'id.token.one' as string | null, calls: [] as any[], expiresInMs: 3_600_000, fail: false }));
vi.mock('./config', () => ({ appConfig: async () => CONFIG }));
vi.mock('./auth', () => ({ getIdToken: async () => state.idToken }));
vi.mock('@aws-sdk/credential-providers', () => ({
  fromCognitoIdentityPool: (params: any) => {
    state.calls.push(params);
    return async () => {
      if (state.fail) throw new Error('ResourceConflictException');
      return {
        accessKeyId: 'TESTACCESSKEYID',
        secretAccessKey: 'test-secret-access-key', // pragma: allowlist secret
        sessionToken: 'session-token',
        expiration: new Date(Date.now() + state.expiresInMs),
        identityId: 'us-east-1:11111111-1111-4111-8111-111111111111',
      };
    };
  },
}));

describe('signing API requests with the identity pool credentials', () => {
  beforeEach(() => {
    forgetCredentials();
    state.idToken = 'id.token.one';
    state.calls = [];
    state.expiresInMs = 3_600_000;
    state.fail = false;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T18:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('trades the ID token at the identity pool, with the user pool as the login provider', async () => {
    await apiCredentials();
    expect(state.calls).toEqual([
      {
        identityPoolId: CONFIG.identityPoolId,
        logins: { 'cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool1': 'id.token.one' },
        clientConfig: { region: 'us-east-1' },
      },
    ]);
  });

  it('keeps the credentials until five minutes before they expire, or until the ID token changes', async () => {
    await apiCredentials();
    await apiCredentials();
    expect(state.calls).toHaveLength(1);
    state.idToken = 'id.token.two';
    await apiCredentials();
    expect(state.calls).toHaveLength(2);
    forgetCredentials();
    state.expiresInMs = 4 * 60_000;
    await apiCredentials();
    await apiCredentials(); // within five minutes of the end: asks again
    expect(state.calls).toHaveLength(4);
  });

  it('lets requests that start together share one exchange, and tries a failed one again', async () => {
    // the app's first requests start at once; several GetId calls for a new identity can fail
    const all = await Promise.all([apiCredentials(), apiCredentials(), apiCredentials()]);
    expect(state.calls).toHaveLength(1);
    expect(new Set(all.map((c) => c!.accessKeyId))).toEqual(new Set(['TESTACCESSKEYID']));
    forgetCredentials();
    state.fail = true;
    await expect(Promise.all([apiCredentials(), apiCredentials()])).rejects.toThrow('ResourceConflictException');
    expect(state.calls).toHaveLength(2);
    state.fail = false;
    await apiCredentials(); // not stuck on the failed exchange
    expect(state.calls).toHaveLength(3);
  });

  it('signs for the lambda service on the function URL host, and leaves Host to the browser', async () => {
    const req = await signedRequest('GET', '/api/node?id=look:58f0a33d', { accept: 'application/json' });
    expect(req!.url).toBe(`${CONFIG.apiUrl}/api/node?id=look%3A58f0a33d`);
    expect(req!.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=TESTACCESSKEYID\/20261112\/us-east-1\/lambda\/aws4_request, SignedHeaders=accept;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/,
    );
    expect(req!.headers['x-amz-date']).toBe('20261112T180000Z');
    expect(req!.headers['x-amz-security-token']).toBe('session-token');
    expect(req!.headers.accept).toBe('application/json');
    // the SHA-256 of the (empty) payload, which the function URL checks against the body it receives
    expect(req!.headers['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(Object.keys(req!.headers).map((k) => k.toLowerCase())).not.toContain('host');
  });

  it('signs the body: a different body, a different signature', async () => {
    const headers = { accept: 'application/json', 'content-type': 'application/json' };
    const a = await signedRequest('POST', '/api/payoff', headers, '{"question":"a"}');
    const b = await signedRequest('POST', '/api/payoff', headers, '{"question":"b"}');
    const again = await signedRequest('POST', '/api/payoff', headers, '{"question":"a"}');
    expect(a!.headers.authorization).toContain('SignedHeaders=accept;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token');
    expect(a!.headers.authorization).not.toBe(b!.headers.authorization);
    expect(a!.headers.authorization).toBe(again!.headers.authorization);
  });

  it('sends the query exactly as it was signed (RFC 3986, as SigV4 canonicalizes it)', async () => {
    const req = await signedRequest('GET', "/api/documents/items?kind=look%20page&q=it's (new)!", {});
    expect(req!.url).toBe(`${CONFIG.apiUrl}/api/documents/items?kind=look%20page&q=it%27s%20%28new%29%21`);
  });

  it('with nobody signed in, signs nothing', async () => {
    state.idToken = null;
    expect(await signedRequest('GET', '/api/health', {})).toBeNull();
    expect(state.calls).toEqual([]);
  });
});
