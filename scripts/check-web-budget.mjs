#!/usr/bin/env node

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../internal/httpapi/assets/', import.meta.url);
const index = readFileSync(new URL('index.html', root), 'utf8');

// The static SPA fallback declares every resource needed to bootstrap the
// client. Count those references rather than the whole route graph, which is
// intentionally lazy and belongs to a separate per-chunk ceiling.
const referenced = new Set(
  [...index.matchAll(/(?:href|src)="([^"?#]+\.(?:js|css))"/g)].map((match) => match[1]),
);

const budgets = {
  initialGzip: 200 * 1024,
  largestChunkGzip: 60 * 1024,
  bundledFonts: 160 * 1024,
};

function gzipBytes(path) {
  return gzipSync(readFileSync(path), { level: 9 }).byteLength;
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

let initialGzip = 0;
for (const asset of referenced) {
  initialGzip += gzipBytes(new URL(asset.replace(/^\//, ''), root));
}

const immutable = fileURLToPath(new URL('_app/immutable/', root));
const js = filesBelow(immutable).filter((path) => extname(path) === '.js');
const largestChunkGzip = Math.max(0, ...js.map(gzipBytes));
const bundledFonts = filesBelow(immutable)
  .filter((path) => path.endsWith('.woff2'))
  .reduce((total, path) => total + statSync(path).size, 0);

const results = [
  ['initial referenced JS/CSS (gzip)', initialGzip, budgets.initialGzip],
  ['largest lazy JS chunk (gzip)', largestChunkGzip, budgets.largestChunkGzip],
  ['bundled WOFF2 fonts', bundledFonts, budgets.bundledFonts],
];

let failed = false;
for (const [label, value, budget] of results) {
  const ok = value <= budget;
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${value} / ${budget} bytes`);
}

if (failed) {
  console.error('Web performance budget exceeded. Inspect the bundle before raising a limit.');
  process.exitCode = 1;
}
