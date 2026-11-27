// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { execFileSync, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * How the Lambda zip of the sample is built, without Docker: the Python package and the ontologies
 * folder (without the data sets' data files and media) copied from the repository, the pinned
 * dependencies installed as wheels of the Lambda platform, as the local bundling of a CDK asset
 * (`bundledCode`). The agent zips are built the same way in agents.ts (`copyAgentBundle`).
 */

/**
 * Python of the four Lambda functions, and the wheels the zip is built for. The latest runtime
 * Lambda offers, which every wheel the zip vendors supports (all of them pure Python); the agents
 * run on the same Python on AgentCore Runtime (agents.ts).
 */
export const LAMBDA_RUNTIME = lambda.Runtime.PYTHON_3_14;
export const LAMBDA_PYTHON_VERSION = '3.14';

/**
 * The packages vendored into the Lambda zip, relative to the repo root: the pinned and hashed
 * dependency closure of the API (`uv pip compile --generate-hashes`, see backend/pyproject.toml):
 * rdflib and pyparsing for the OWL explorer, boto3 with its dependencies because the boto3 that
 * ships with the Lambda runtime varies by Region and over time and tab 3 needs a botocore new
 * enough to have the `s3vectors` client (tab 2 the `bedrock-agentcore` one). No token library: IAM
 * decides who may call the API (auth.ts). Installed with --no-deps, so
 * every dependency is listed, and --require-hashes, so a wheel that does not match its recorded
 * hash is refused. Code in /var/task comes before the runtime's own boto3 on sys.path, so the
 * pinned boto3/botocore is the one used. The query agent and its Neptune MCP server are not in
 * this zip: they run on AgentCore Runtime (agents.ts).
 */
export const LAMBDA_REQUIREMENTS = path.join('backend', 'lambda-requirements.txt');

/**
 * Package backend/src/ontology_rag + ontologies/ (copyOntologies) into the Lambda asset without
 * Docker (local bundling), with the packages of LAMBDA_REQUIREMENTS vendored in.
 */
export function bundledCode(repoRoot: string): lambda.Code {
  const src = path.join(repoRoot, 'backend', 'src');
  return lambda.Code.fromAsset(src, {
    assetHashType: cdk.AssetHashType.OUTPUT,
    bundling: {
      image: LAMBDA_RUNTIME.bundlingImage,
      local: {
        tryBundle(outputDir: string): boolean {
          copyLambdaBundle(repoRoot, outputDir);
          return true;
        },
      },
    },
  });
}

/** The content of the Lambda zip, written into the asset's output directory. */
export function copyLambdaBundle(repoRoot: string, outputDir: string): void {
  const copy = (from: string, to: string) => fs.cpSync(from, to, { recursive: true, filter: (p) => !p.includes('__pycache__') });
  copy(path.join(repoRoot, 'backend', 'src', 'ontology_rag'), path.join(outputDir, 'ontology_rag'));
  copyOntologies(repoRoot, outputDir);
  vendorPythonPackages(outputDir, path.join(repoRoot, LAMBDA_REQUIREMENTS));
}

/**
 * The ontologies folder into the Lambda zip (the fallback when the data bucket is unreachable):
 * the .ttl files, their READMEs, domain.json and the example inputs under examples/ (the photos,
 * the single pieces of examples/items/ and the texts, with their manifests); not the build scripts
 * (*.py), as the OntologiesSource asset. Of a data set (ontologies/<domain>/datasets/<set>/) only
 * what the request-serving functions list goes in (inLambdaZip); the set's data and media reach
 * the graph loader through the data bucket.
 */
export function copyOntologies(repoRoot: string, outputDir: string): void {
  const root = path.join(repoRoot, 'ontologies');
  fs.cpSync(root, path.join(outputDir, 'ontologies'), {
    recursive: true,
    filter: (p) => {
      if (p.includes('__pycache__') || p.endsWith('.py')) return false;
      return inLambdaZip(path.relative(root, p).split(path.sep), fs.statSync(p).isDirectory());
    },
  });
}

/** The folder of a domain that holds its data sets (backend ontologies.py DATASETS_DIR). */
const DATASETS_DIR = 'datasets';
/** The folder of a domain or a data set that holds its example inputs (EXAMPLES_DIR). */
const EXAMPLES_DIR = 'examples';
/** The folder of a data set that holds its own photos, served by key (MEDIA_DIR). */
const MEDIA_DIR = 'media';
/** The files of a data set that describe the set, not data the loader reads. */
const SET_FILES = ['README.md', 'domain.json'];
/** The folders of examples/ whose top-level files are example inputs (and their manifest.json). */
const EXAMPLE_FOLDERS = ['images', 'items', 'articles'];

/**
 * Whether a path under ontologies/ (given as its parts) goes into the Lambda zip. Everything
 * outside a data set folder does. Inside ontologies/<domain>/datasets/<set>/ only README.md,
 * domain.json and the top-level files of examples/images/, examples/items/ and
 * examples/articles/ do; the set's other top-level files (graph.json, vectors.json, catalog.json,
 * items.json, ...), its photos under media/ (media/looks/, media/products/) and any other folder
 * stay out. Only the graph loader reads them, at deploy, from the data bucket; S3Sync in backend
 * ontologies.py skips the same keys for the other functions.
 */
function inLambdaZip(parts: string[], isDirectory: boolean): boolean {
  const [, datasets, set, ...rest] = parts;
  if (datasets !== DATASETS_DIR || set === undefined || rest.length === 0) return true; // the domain folder, datasets/README.md, a set's folder
  const [first, kind] = rest;
  if (first === MEDIA_DIR) return false; // the set's own photos: the data bucket only
  if (rest.length === 1) return isDirectory ? first === EXAMPLES_DIR : SET_FILES.includes(first);
  if (first !== EXAMPLES_DIR || !EXAMPLE_FOLDERS.includes(kind)) return false;
  return rest.length === 2 ? isDirectory : rest.length === 3 && !isDirectory;
}

/**
 * Install a hashed requirements file into the bundle with `uv pip install --target` (preferred, no
 * venv needed) or `python3 -m pip install --target`. Both ask for wheels of the Lambda platform
 * (CPython 3.14, manylinux2014 x86_64), so the result is right for the runtime whatever machine
 * builds the zip: the Lambda zip's packages come as py3-none-any wheels, and an agent's compiled
 * packages as wheels of its platform.
 * --require-hashes makes either installer compare every wheel with the hashes the file records.
 */
export function vendorPythonPackages(outputDir: string, requirements: string, runtimeVersion = LAMBDA_PYTHON_VERSION): void {
  const common = ['--no-deps', '--only-binary=:all:', '--require-hashes', '--target', outputDir, '-r', requirements];
  const hasUv = spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0;
  if (hasUv) {
    execFileSync('uv', ['pip', 'install', '--quiet', '--python-version', runtimeVersion, '--python-platform', 'x86_64-manylinux2014', ...common], { stdio: 'inherit' });
  } else {
    const platform = ['--platform', 'manylinux2014_x86_64', '--implementation', 'cp', '--python-version', runtimeVersion];
    execFileSync('python3', ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--no-compile', ...platform, ...common], { stdio: 'inherit' });
  }
  // Drop pip metadata that is not needed at runtime (keeps the zip small and deterministic).
  for (const entry of fs.readdirSync(outputDir)) {
    if (entry.endsWith('.dist-info')) {
      for (const f of ['RECORD', 'INSTALLER', 'REQUESTED', 'direct_url.json', 'uv_cache.json']) {
        fs.rmSync(path.join(outputDir, entry, f), { force: true });
      }
    }
  }
  fs.rmSync(path.join(outputDir, 'bin'), { recursive: true, force: true }); // console scripts (rdfpipe, ...)
}

/**
 * A short hash of the loader's inputs: every .ttl and .json under these directories (the ontology,
 * its example manifests and its data sets), by relative path, so an edit anywhere re-runs it.
 */
export function contentHash(...dirs: string[]): string {
  const h = crypto.createHash('sha256');
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(ttl|json)$/.test(f));
    for (const f of files.sort()) {
      h.update(f);
      h.update(fs.readFileSync(path.join(dir, f)));
    }
  }
  return h.digest('hex').slice(0, 16);
}
