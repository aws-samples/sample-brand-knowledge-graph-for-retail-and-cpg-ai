// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { contentHash, copyOntologies } from '../lib/bundling';
import { MultimodalAiKnowledgeGraphStack } from '../lib/multimodal-ai-knowledge-graph-stack';

/**
 * The ontologies folder reaches both places the API reads it from: the data bucket (the
 * OntologiesSource asset of the OntologiesDeploy BucketDeployment) and the Lambda zip (the
 * fallback); tab 5's single pieces (ontologies/fashion/examples/items/) included, the build scripts
 * not. The data sets (ontologies/<domain>/datasets/<set>/) go to the data bucket whole; the Lambda
 * zip takes only their README, domain.json and example inputs (copyOntologies).
 */
const REPO = path.resolve(__dirname, '..', '..');
const FASHION = path.join(REPO, 'ontologies', 'fashion');
const SET = path.join('datasets', 'velloway');
const ITEMS = path.join('examples', 'items');
const PIECES = fs.readdirSync(path.join(FASHION, ITEMS)).filter((f) => f.endsWith('.jpg'));

/** Every file under a folder, by relative path. */
const filesUnder = (dir: string): string[] => (fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[]).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();

describe('the ontologies folder in the deployed copies', () => {
  test('the repository has the pieces and their manifest', () => {
    expect(PIECES.length).toBeGreaterThanOrEqual(8);
    expect(fs.existsSync(path.join(FASHION, ITEMS, 'manifest.json'))).toBe(true);
  });

  test('the Lambda zip gets examples/items/ with its manifest, not the .py scripts', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ontologies-bundle-'));
    try {
      copyOntologies(REPO, out);
      const files = filesUnder(path.join(out, 'ontologies', 'fashion'));
      expect(files).toEqual(expect.arrayContaining([`${ITEMS}/manifest.json`, `${ITEMS}/README.md`, ...PIECES.map((f) => `${ITEMS}/${f}`), 'examples/images/manifest.json', 'domain.json']));
      expect(files.filter((f) => f.endsWith('.py') || f.includes('__pycache__'))).toEqual([]);
      // the sample's data set: its README and example lists, not its catalog files
      expect(files).toEqual(expect.arrayContaining(['datasets/README.md', `${SET}/README.md`, `${SET}/domain.json`]));
      expect(files.filter((f) => f.startsWith(`${SET}/`) && !['README.md', 'domain.json'].includes(path.basename(f)))).toEqual([]);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('the data bucket gets examples/items/ through the OntologiesSource asset, not the .py scripts', () => {
    const app = new cdk.App({ context: { '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false, 'aws:cdk:bundling-stacks': [] } });
    const stack = new MultimodalAiKnowledgeGraphStack(app, 'Test', { env: { account: '111111111111', region: 'us-east-1' } });
    const asset = stack.node.findChild('OntologiesSource') as s3_assets.Asset;
    const staged = path.join(app.assetOutdir, asset.assetPath);
    const files = filesUnder(path.join(staged, 'fashion'));
    expect(files).toEqual(expect.arrayContaining([`${ITEMS}/manifest.json`, `${ITEMS}/README.md`, ...PIECES.map((f) => `${ITEMS}/${f}`)]));
    expect(files.filter((f) => f.endsWith('.py') || f.includes('__pycache__'))).toEqual([]);
    // the data set whole: the graph loader reads its catalog files from the bucket
    expect(files).toEqual(expect.arrayContaining([`${SET}/README.md`, `${SET}/domain.json`, `${SET}/items.json`, `${SET}/looks.json`]));
  });

  test("the Lambda zip keeps a data set's README, domain.json and example inputs, not its data files or media/", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ontologies-set-'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ontologies-set-bundle-'));
    try {
      const domain = path.join(repo, 'ontologies', 'fashion');
      const set = path.join(domain, 'datasets', 's1');
      const write = (file: string) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{}\n');
      };
      for (const f of ['fashion.ttl', 'domain.json', 'examples/images/manifest.json', 'examples/images/01.jpg', 'datasets/README.md']) write(path.join(domain, f));
      for (const f of [
        'README.md',
        'domain.json',
        'graph.json',
        'examples/README.md',
        'examples/images/manifest.json',
        'examples/images/a.jpg',
        'examples/images/looks/c.jpg',
        'examples/articles/x.md',
        'examples/other/y.jpg',
        'images/z.jpg', // the old layout: no example
        'media/looks/b.jpg',
        'media/products/p.jpg',
      ]) {
        write(path.join(set, f));
      }
      copyOntologies(repo, out);
      expect(filesUnder(path.join(out, 'ontologies', 'fashion'))).toEqual([
        'datasets/README.md',
        'datasets/s1/README.md',
        'datasets/s1/domain.json',
        'datasets/s1/examples/articles/x.md',
        'datasets/s1/examples/images/a.jpg',
        'datasets/s1/examples/images/manifest.json',
        'domain.json',
        'examples/images/01.jpg',
        'examples/images/manifest.json',
        'fashion.ttl',
      ]);
      expect(fs.existsSync(path.join(out, 'ontologies', 'fashion', 'datasets', 's1', 'media'))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test("the graph loader's content hash reads examples/items/manifest.json (and only manifests, not the JPEGs)", () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ontologies-hash-'));
    try {
      fs.cpSync(FASHION, copy, { recursive: true });
      const before = contentHash(copy);
      fs.appendFileSync(path.join(copy, ITEMS, PIECES[0]), 'x');
      expect(contentHash(copy)).toBe(before);
      fs.appendFileSync(path.join(copy, ITEMS, 'manifest.json'), '\n');
      expect(contentHash(copy)).not.toBe(before);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });
});
