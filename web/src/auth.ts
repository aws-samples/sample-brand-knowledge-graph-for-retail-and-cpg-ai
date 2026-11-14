// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Sign-in with Amazon Cognito managed login (authorization code + PKCE) through oidc-client-ts.
 *
 * `/config.json` (config.ts) names the stack's user pool, app client and managed-login domain.
 * The ID token of the signed-in user buys the AWS credentials every API request is signed with
 * (signing.ts); no token is sent to the API.
 */
import { UserManager, WebStorageStateStore, type UserManagerSettings } from 'oidc-client-ts';
import { appConfig, type AppConfig } from './config';
import { forgetCredentials } from './signing';

/** The oidc-client-ts settings for the stack's user pool and app client. */
export function managerSettings(config: AppConfig, redirectUri: string, store: Storage): UserManagerSettings {
  return {
    authority: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
    client_id: config.clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    // The refresh token renews the tokens in the background; no iframe, no new sign-in.
    automaticSilentRenew: true,
    // One session per browser tab, gone when the tab closes.
    userStore: new WebStorageStateStore({ store }),
    // Cognito's discovery document does not list its sign-out endpoint.
    metadataSeed: { end_session_endpoint: `https://${config.domain}/logout` },
  };
}

function redirectUri(): string {
  return `${location.origin}/`;
}

let manager: Promise<UserManager> | undefined;

/** The one UserManager of this page. */
export function userManager(): Promise<UserManager> {
  manager ??= appConfig().then((config) => new UserManager(managerSettings(config, redirectUri(), sessionStorage)));
  return manager;
}

/**
 * The signed-in user's ID token, renewed through the refresh token if it has expired; null when
 * nobody is signed in. The identity pool takes it in exchange for the API credentials (signing.ts).
 */
export async function getIdToken(): Promise<string | null> {
  const m = await userManager();
  let user = await m.getUser();
  if (user?.expired) user = await m.signinSilent().catch(() => null);
  return user?.id_token ?? null;
}

/** Who is signed in, for the header: the email, else the username. */
export async function signedInUser(): Promise<string | null> {
  const user = await (await userManager()).getUser();
  if (!user) return null;
  return String(user.profile.email ?? user.profile['cognito:username'] ?? user.profile.sub);
}

/** Send the browser to managed login; it comes back to `redirect_uri` with `?code=&state=`. */
export async function signIn(): Promise<void> {
  await (await userManager()).signinRedirect();
}

/**
 * True when another page shows the app in a frame (a slide deck that embeds the demo; the stack
 * allows that only for the origins named with `-c frameAncestors=`).
 */
export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // a cross-origin parent hides window.top on some browsers
  }
}

/**
 * Sign in from a frame. Managed login refuses to be framed (X-Frame-Options: DENY), so it opens
 * in a popup; the popup comes back to `redirect_uri` and hands the response to this frame
 * (handleCallback), which exchanges the code and keeps the tokens in its own sessionStorage.
 */
export async function signInPopup(): Promise<void> {
  await (await userManager()).signinPopup();
}

/**
 * Call `then` once another frame of the same tab has signed in. Frames of the app in one deck share
 * the tab's sessionStorage, so the frame that signed in through the popup writes the user there and
 * the browser tells every other frame with a `storage` event; a frame still showing its sign-in
 * button can then start without a second sign-in. Returns a function that stops listening.
 */
export function onSignInElsewhere(then: () => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.storageArea === sessionStorage && e.key?.startsWith('oidc.user:') && e.newValue) {
      window.removeEventListener('storage', listener);
      then();
    }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

/**
 * Back from managed login with `?code=&state=`. In the popup a framed app opened, the request
 * state lives in the frame's storage (partitioned under the embedding site), so the popup only
 * passes the URL to its opener and closes: `popup`. Otherwise exchange the code for tokens and
 * drop the parameters from the URL: `signed-in`.
 */
export async function handleCallback(): Promise<'signed-in' | 'popup'> {
  const m = await userManager();
  if (window.opener && window.opener !== window) {
    await m.signinPopupCallback();
    return 'popup';
  }
  await m.signinCallback();
  history.replaceState(null, '', location.pathname);
  return 'signed-in';
}

/**
 * What the app itself keeps for the signed-in user, removed at sign-out so the next person in this
 * browser tab starts empty: tab 1's results and image (sessionStorage `studio.*`, studioCache.ts),
 * every other tab's answers and inputs (`kept.*`, kept.ts), tab 6's agent methods
 * (`lens.trends.*`, trendsCache.ts) and the pipeline's last run (localStorage, useRun.ts). UI
 * choices such as a model stay.
 */
const SESSION_PREFIXES = ['studio.', 'kept.', 'lens.trends.'];
const LOCAL_KEYS = ['oaai.pipeline.run'];

function forgetUserData(): void {
  try {
    for (const key of Object.keys(sessionStorage)) if (SESSION_PREFIXES.some((p) => key.startsWith(p))) sessionStorage.removeItem(key);
    for (const key of LOCAL_KEYS) localStorage.removeItem(key);
  } catch {
    // storage disabled: nothing was kept
  }
}

/** Drop the tokens and the API credentials and end the Cognito session; Cognito's /logout wants `client_id` and an allowed sign-out URL as `logout_uri`. */
export async function signOut(): Promise<void> {
  forgetUserData();
  forgetCredentials();
  const m = await userManager();
  await m.signoutRedirect({ extraQueryParams: { client_id: m.settings.client_id, logout_uri: redirectUri() } });
}
