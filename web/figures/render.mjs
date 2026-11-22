// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Renders the README figures to ../../assets/: a 2x PNG of each, and an SVG of those listed in SVG.
// Usage (from web/): node figures/render.mjs [name ...]   (or `make figures` at the repository root)
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'assets');
// The README figures, then the tab figures of specs/tabs/ (two per tab; a name with a folder renders
// into that subfolder of assets/).
const TABS = (await readdir(join(here, 'specs', 'tabs'))).filter((f) => f.endsWith('.ts') && f !== 'index.ts').map((f) => `tabs/${f.slice(0, -3)}`).sort();
const ALL = ['architecture', 'ingest-pipeline', 'rag-vs-graphrag', 'graph-model', 'data-layout', ...TABS];
const SVG = new Set(ALL);
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
// Room around the canvas so the outermost tiles' badges and borders are not cut.
const MARGIN = 24;

const server = await createServer({ root: here, configFile: false, plugins: [react()], logLevel: 'warn', server: { strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
try {
  await mkdir(out, { recursive: true });
  for (const name of names) await render(name);
} finally {
  await browser.close();
  await server.close();
}

async function render(name) {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1600 } });
  page.on('pageerror', (e) => console.error(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.error(`${name}: ${m.text()}`));
  await page.goto(`${base}?figure=${name}`);
  await page.waitForFunction(() => {
    const fig = document.getElementById('figure');
    return fig && document.querySelectorAll('.react-flow__edge-path').length === Number(fig.dataset.edges);
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((m) => (document.body.style.padding = `${m}px`), MARGIN);
  await page.waitForTimeout(300);
  const box = await page.locator('#figure').boundingBox();
  await mkdir(dirname(join(out, name)), { recursive: true });
  const png = join(out, `${name}.png`);
  await page.screenshot({ path: png, clip: { x: box.x - MARGIN, y: box.y - MARGIN, width: box.width + 2 * MARGIN, height: box.height + 2 * MARGIN } });
  console.log(`${png}`);
  if (SVG.has(name)) {
    const svg = await page.evaluate(toSvg, MARGIN);
    await writeFile(join(out, `${name}.svg`), svg);
    console.log(join(out, `${name}.svg`));
  }
  await page.close();
}

// In the page: the figure as one SVG. The edges are SVG already; the tiles are HTML, so they go in
// a <foreignObject> with every computed style inlined (an SVG shown as an image loads no CSS).
function toSvg(margin) {
  const fig = document.getElementById('figure');
  const { width, height } = fig.getBoundingClientRect();
  const clone = fig.cloneNode(true);
  // Only what differs from a plain element of the same tag, so the file stays small. The plain
  // elements live in an empty iframe: the app's CSS (box-sizing on *, for one) must not reach them.
  const sandbox = document.createElement('iframe');
  document.body.appendChild(sandbox);
  const plainDoc = sandbox.contentDocument;
  const defaults = {};
  const defaultsOf = (el) => {
    const key = `${el.namespaceURI}:${el.tagName}`;
    if (!defaults[key]) {
      const probe = plainDoc.createElementNS(el.namespaceURI, el.tagName);
      plainDoc.body.appendChild(probe);
      const cs = sandbox.contentWindow.getComputedStyle(probe);
      defaults[key] = Object.fromEntries([...cs].map((p) => [p, cs.getPropertyValue(p)]));
    }
    return defaults[key];
  };
  const ROOT = ['font-family', 'font-size', 'line-height', 'color', '-webkit-font-smoothing'];
  const inline = (src, dst, root = false) => {
    if (src.nodeType !== 1) return;
    const cs = getComputedStyle(src);
    const plain = defaultsOf(src);
    let text = '';
    for (const prop of cs) {
      // Custom properties are already resolved into the real ones.
      if (prop.startsWith('--')) continue;
      const value = cs.getPropertyValue(prop);
      if (value !== plain[prop] || (root && ROOT.includes(prop))) text += `${prop}:${value};`;
    }
    dst.setAttribute('style', text);
    dst.removeAttribute('class');
    for (let i = 0; i < src.childNodes.length; i++) inline(src.childNodes[i], dst.childNodes[i]);
  };
  // Mark what a picture does not need (the invisible handles, React Flow's screen-reader text) before
  // the classes go, then drop it.
  for (const el of clone.querySelectorAll('.react-flow__handle, [id^="react-flow__node-desc"], [id^="react-flow__edge-desc"], [id^="react-flow__aria-live"]')) el.dataset.drop = '1';
  inline(fig, clone, true);
  for (const el of clone.querySelectorAll('[data-drop]')) el.remove();
  sandbox.remove();
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const w = Math.ceil(width + 2 * margin);
  const h = Math.ceil(height + 2 * margin);
  const xhtml = new XMLSerializer().serializeToString(clone);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#fff"/><foreignObject x="${margin}" y="${margin}" width="${Math.ceil(width)}" height="${Math.ceil(height)}">${xhtml}</foreignObject></svg>\n`;
}
