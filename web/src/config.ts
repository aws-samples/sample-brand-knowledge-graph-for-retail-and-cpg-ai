// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * What the app needs before it can sign in or call the API, read from `/config.json` on its own
 * origin. The stack writes that file into the site bucket at deploy time (infra: webConfig), so no
 * id is in the code or the bundle.
 */
export type AppConfig = {
  region: string;
  /** The Cognito user pool and its app client the browser signs in with (auth.ts). */
  userPoolId: string;
  clientId: string;
  /** The managed-login host, `<prefix>.auth.<region>.amazoncognito.com`. */
  domain: string;
  /** The identity pool that turns the signed-in user's ID token into AWS credentials (signing.ts). */
  identityPoolId: string;
  /** The API's Lambda function URL, `https://<id>.lambda-url.<region>.on.aws`, no trailing slash. */
  apiUrl: string;
};

const FIELDS: (keyof AppConfig)[] = ['region', 'userPoolId', 'clientId', 'domain', 'identityPoolId', 'apiUrl'];

/** The config as the file has it, checked for every field. */
export function parseConfig(json: unknown): AppConfig {
  const missing = FIELDS.filter((f) => typeof (json as Record<string, unknown> | null)?.[f] !== 'string' || !(json as Record<string, string>)[f]);
  if (missing.length) throw new Error(`config.json lacks ${missing.join(', ')}`);
  return json as AppConfig;
}

let loaded: Promise<AppConfig> | undefined;

/** The one config of this page, fetched once. */
export function appConfig(): Promise<AppConfig> {
  loaded ??= fetch('/config.json', { cache: 'no-store' }).then(async (res) => {
    if (!res.ok) throw new Error(`config.json answered ${res.status}`);
    return parseConfig(await res.json());
  });
  return loaded;
}
