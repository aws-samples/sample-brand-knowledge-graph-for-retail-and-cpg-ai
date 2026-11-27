// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// One cloud assembly folder per test file, deleted when the file is done. A `cdk.App` without an
// outdir synthesizes into a new temporary `cdk.out*` folder that nothing deletes: about 120
// folders of 26 MB each per `npx jest` run, which filled a laptop's disk after a few days of runs.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk.out-jest-'));
process.env.CDK_OUTDIR = outdir;

afterAll(() => {
  fs.rmSync(outdir, { recursive: true, force: true });
});
