// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

const FUNCTION_URL = 'https://abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-1.on.aws';
const auth = vi.hoisted(() => ({ signIn: vi.fn(async () => {}) }));
const signing = vi.hoisted(() => ({
  signedIn: true,
  forgetCredentials: vi.fn(),
  signedRequest: vi.fn(),
}));
vi.mock('./auth', () => ({ signIn: auth.signIn }));
vi.mock('./signing', () => ({ signedRequest: signing.signedRequest, forgetCredentials: signing.forgetCredentials }));

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('the API client: every request signed, sent to the function URL', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    auth.signIn.mockClear();
    signing.forgetCredentials.mockClear();
    signing.signedIn = true;
    signing.signedRequest.mockReset();
    signing.signedRequest.mockImplementation(async (_method: string, path: string, headers: Record<string, string>) =>
      signing.signedIn ? { url: `${FUNCTION_URL}${path}`, headers: { ...headers, authorization: 'AWS4-HMAC-SHA256 Credential=ASIA.../lambda/aws4_request', 'x-amz-date': '20261112T180000Z', 'x-amz-security-token': 'token' } } : null,
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const sent = (call = 0) => fetchMock.mock.calls[call] as [string, RequestInit];

  it('sends the signed headers to the function URL, and no token of its own', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }));
    await api.health();
    const [url, init] = sent();
    expect(url).toBe(`${FUNCTION_URL}/api/health`);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers).not.toHaveProperty('x-access-token');
    expect(signing.signedRequest).toHaveBeenCalledWith('GET', '/api/health', { accept: 'application/json' }, undefined);
  });

  it('signs a POST with its body and content type', async () => {
    fetchMock.mockResolvedValue(reply(200, { columns: {} }));
    await api.payoff('What goes with white sneakers?');
    const [, init] = sent();
    expect(init.method).toBe('POST');
    const body = JSON.stringify({ question: 'What goes with white sneakers?' });
    expect(init.body).toBe(body);
    expect(signing.signedRequest).toHaveBeenCalledWith('POST', '/api/payoff', { accept: 'application/json', 'content-type': 'application/json' }, body);
  });

  it('with nobody signed in, goes to sign-in and sends nothing', async () => {
    signing.signedIn = false;
    await expect(api.summary()).rejects.toMatchObject({ status: 401, message: 'sign-in required' });
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('when IAM refuses the credentials, tries once more with fresh ones, then signs in again', async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { message: 'The security token included in the request is expired' })).mockResolvedValueOnce(reply(200, { nodes: {}, edges: {} }));
    await expect(api.summary()).resolves.toEqual({ nodes: {}, edges: {} });
    expect(signing.forgetCredentials).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.signIn).not.toHaveBeenCalled();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(reply(403, { Message: 'Forbidden' })).mockResolvedValueOnce(reply(200, { nodes: {}, edges: {} }));
    await expect(api.summary()).resolves.toEqual({ nodes: {}, edges: {} });
    expect(signing.forgetCredentials).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => reply(403, { Message: 'Forbidden' }));
    await expect(api.summary()).rejects.toMatchObject({ status: 403, message: 'sign-in required' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });

  it("keeps the API's own 403 (a refused write query) as an error, without new credentials", async () => {
    fetchMock.mockResolvedValue(reply(403, { error: 'clearing the graph needs allowWriteQueries' }));
    await expect(api.summary()).rejects.toMatchObject({ status: 403, message: 'clearing the graph needs allowWriteQueries' });
    expect(signing.forgetCredentials).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a refusal the browser hides as a network error (no CORS headers) gets one retry with fresh credentials', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(reply(200, { ok: true }));
    await expect(api.health()).resolves.toEqual({ ok: true });
    expect(signing.forgetCredentials).toHaveBeenCalledTimes(1);
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.health()).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports other errors with the API message', async () => {
    fetchMock.mockResolvedValue(reply(409, { error: 'the catalog index does not exist yet' }));
    await expect(api.catalogInfo()).rejects.toMatchObject({ status: 409, message: 'the catalog index does not exist yet' });
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('retries a GET the API refused with 429 (its concurrency), but never a POST', async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { message: 'Too Many Requests' })).mockResolvedValueOnce(reply(200, { key: 'k', data_url: 'data:x' }));
    await expect(api.photo('whimsikora/looks/a.jpg')).resolves.toMatchObject({ data_url: 'data:x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(reply(429, { message: 'Too Many Requests' }));
    await expect(api.payoff('q')).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('names tab 6’s outfit by its domain and example file, not a stored key', async () => {
    fetchMock.mockImplementation(async () => reply(200, {}));
    await api.lensCheckLooks('fashion', 'sage-tailoring.jpg', 'MATCH (l:Look) RETURN l');
    await api.lensCheckLooks('fashion', 'trench-midi.jpg');
    await api.lensCheckPieces('fashion', 'sage-tailoring.jpg', []);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${FUNCTION_URL}/api/lenses/check/looks`, `${FUNCTION_URL}/api/lenses/check/looks`, `${FUNCTION_URL}/api/lenses/check/pieces`]);
    expect(fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]!.body)))).toEqual([
      { ontology_id: 'fashion', example: 'sage-tailoring.jpg', cypher: 'MATCH (l:Look) RETURN l' },
      { ontology_id: 'fashion', example: 'trench-midi.jpg' },
      { ontology_id: 'fashion', example: 'sage-tailoring.jpg', looks: [] },
    ]);
  });

  it('sends a photo as image_base64 with the question (Style recommendation)', async () => {
    fetchMock.mockResolvedValue(reply(200, { columns: {} }));
    await api.payoff('What goes with this?', { image: 'data:image/jpeg;base64,AAAA' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ question: 'What goes with this?', image_base64: 'data:image/jpeg;base64,AAAA' });
  });
});
