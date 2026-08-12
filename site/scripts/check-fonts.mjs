// Fails if the site's vendored fonts have drifted from the app's.
//
// The site self-hosts its fonts rather than fetching them from Google, which is
// the whole argument the page makes about where your data should live. They are
// copies of the same @fontsource-variable files web/ vendors, and today they are
// byte-identical. Nothing enforced that, so a dependency bump in web/ would
// leave the site rendering a different cut of the same typeface than the app it
// is advertising.
//
// Usage: node scripts/check-fonts.mjs

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sitePublic = resolve(here, '../public/fonts');
const webModules = resolve(here, '../../web/node_modules/@fontsource-variable');

const FONTS = [
  ['fraunces', 'fraunces-latin-wght-normal.woff2'],
  ['geist', 'geist-latin-wght-normal.woff2'],
  ['geist-mono', 'geist-mono-latin-wght-normal.woff2']
];

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (!existsSync(webModules)) {
  // Not an error: web/node_modules is not installed in every job or checkout,
  // and a gate that fails on a missing optional input is a gate people delete.
  console.log('web/node_modules not installed — skipping font drift check');
  process.exit(0);
}

const problems = [];
for (const [pkg, file] of FONTS) {
  const mine = resolve(sitePublic, file);
  const theirs = resolve(webModules, pkg, 'files', file);
  if (!existsSync(mine)) {
    problems.push(`site/public/fonts/${file} is missing`);
    continue;
  }
  if (!existsSync(theirs)) {
    problems.push(`web vendors no longer ships ${pkg}/files/${file} — this gate needs updating`);
    continue;
  }
  if (sha(mine) !== sha(theirs)) {
    problems.push(`${file} differs from the copy in web/node_modules/@fontsource-variable/${pkg}`);
  }
}

if (problems.length > 0) {
  console.error('\nThe site fonts have drifted from the app fonts:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nCopy them across again:\n' +
      '  cp web/node_modules/@fontsource-variable/{fraunces,geist,geist-mono}/files/*-latin-wght-normal.woff2 site/public/fonts/\n'
  );
  process.exit(1);
}

console.log(`site fonts match web/node_modules (${FONTS.length} files checked)`);
