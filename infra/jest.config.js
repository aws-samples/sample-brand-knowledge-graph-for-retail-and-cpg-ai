// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.tsx?$': 'ts-jest' },
  // every cdk.App of a test file synthesizes into one temporary folder that is deleted afterwards
  setupFilesAfterEnv: ['<rootDir>/test/outdir.setup.ts'],
};
