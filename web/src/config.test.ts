// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

const CONFIG = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_TestPool1',
  clientId: '1example23456789abcdefghij',
  domain: 'multimodal-ai-knowledge-graph-abcd1234.auth.us-east-1.amazoncognito.com',
  identityPoolId: 'us-east-1:00000000-0000-4000-8000-000000000000',
  apiUrl: 'https://abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-1.on.aws',
};

describe('/config.json, written by the stack at deploy time', () => {
  it('takes a config with every field', () => {
    expect(parseConfig(CONFIG)).toEqual(CONFIG);
  });

  it('names what is missing or empty', () => {
    const { identityPoolId: _, ...rest } = CONFIG;
    expect(() => parseConfig({ ...rest, apiUrl: '' })).toThrow('config.json lacks identityPoolId, apiUrl');
    expect(() => parseConfig(null)).toThrow('config.json lacks region');
  });
});
