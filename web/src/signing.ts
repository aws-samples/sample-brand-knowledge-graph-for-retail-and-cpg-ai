// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * How a request reaches the API: signed with AWS Signature Version 4 by the AWS SDK, with the
 * signed-in user's temporary credentials, and sent to the API's Lambda function URL.
 *
 * 1. The Cognito identity pool exchanges the user's ID token for credentials of one IAM role
 *    (`fromCognitoIdentityPool`: GetId, then GetCredentialsForIdentity).
 * 2. `SignatureV4` signs each request for the service `lambda`.
 * 3. The function URL (AuthType AWS_IAM) runs the API only when IAM allows that role to invoke it.
 *
 * The app never checks a token itself, and neither does the API.
 */
import { Sha256 } from '@aws-crypto/sha256-js';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { SignatureV4 } from '@smithy/signature-v4';
import { getIdToken } from './auth';
import { appConfig } from './config';

type Credentials = Awaited<ReturnType<ReturnType<typeof fromCognitoIdentityPool>>>;

/** Renew the credentials this long before they expire (they last an hour). */
const RENEW_BEFORE_MS = 5 * 60_000;

let kept: { credentials: Credentials; idToken: string } | undefined;
/** The exchange under way: the app's first requests start together and share it. */
let exchanging: { promise: Promise<Credentials>; idToken: string } | undefined;

/** The signed-in user's credentials for the API, or null when nobody is signed in. Kept in memory only. */
export async function apiCredentials(): Promise<Credentials | null> {
  const idToken = await getIdToken();
  if (!idToken) return null;
  const expires = kept?.credentials.expiration?.getTime() ?? 0;
  if (kept && kept.idToken === idToken && expires - Date.now() > RENEW_BEFORE_MS) return kept.credentials;
  // One exchange at a time: after the first sign-in, several GetId calls at once for an identity
  // the pool does not know yet can fail (HTTP 400), and the header then showed no graph.
  if (!exchanging || exchanging.idToken !== idToken) exchanging = { promise: exchange(idToken), idToken };
  const current = exchanging;
  try {
    const credentials = await current.promise;
    // Kept only while this exchange is still the current one: after forgetCredentials() (sign-out,
    // or credentials the API refused) an exchange that was under way must not store them again.
    if (exchanging === current) kept = { credentials, idToken };
    return credentials;
  } finally {
    if (exchanging === current) exchanging = undefined; // a failed exchange is tried again next time
  }
}

/** The ID token traded at the identity pool (GetId, then GetCredentialsForIdentity). */
async function exchange(idToken: string): Promise<Credentials> {
  const config = await appConfig();
  const provider = fromCognitoIdentityPool({
    identityPoolId: config.identityPoolId,
    logins: { [`cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`]: idToken },
    clientConfig: { region: config.region },
  });
  return provider();
}

/** Drop the kept credentials: after sign-out, or when the API refused them. */
export function forgetCredentials(): void {
  kept = undefined;
  exchanging = undefined;
}

/** RFC 3986 encoding, as SigV4 canonicalizes a query: encodeURIComponent leaves !'()* alone. */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * One API request, signed: the URL on the function URL host and the headers to send, or null when
 * nobody is signed in. `path` is the API path with its query (`/api/node?id=look:1`); the query is
 * sent exactly as it was signed.
 */
export async function signedRequest(method: string, path: string, headers: Record<string, string>, body?: string): Promise<{ url: string; headers: Record<string, string> } | null> {
  const credentials = await apiCredentials();
  if (!credentials) return null;
  const config = await appConfig();
  const url = new URL(path, config.apiUrl);
  const query = Object.fromEntries(url.searchParams);
  const signer = new SignatureV4({ service: 'lambda', region: config.region, credentials, sha256: Sha256 });
  const signed = await signer.sign({
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    query,
    headers: { ...headers, host: url.hostname },
    body,
  });
  const { host: _host, ...send } = signed.headers; // the browser sets Host itself
  const search = Object.entries(query)
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&');
  return { url: `${url.origin}${url.pathname}${search ? `?${search}` : ''}`, headers: send };
}
