// Fails if the site's palette has drifted from the app's.
//
// site/src/styles/site.css re-declares the app's colours under marketing names
// (--paper, --ink, --stamp) rather than importing web/src/app.css, because the
// two files have genuinely different jobs: the app's is a Tailwind v4 @theme
// block with shadcn token names and a class-based dark mode, and the site is
// hand-rolled CSS keyed off prefers-color-scheme. Sharing the file would mean
// shipping Tailwind to a static marketing page.
//
// What that costs is a silent failure mode: change the app's palette and the
// site keeps rendering the old one, with nothing to say so. The mobile client
// has exactly this relationship and solved it by GENERATING its tokens from
// app.css with a CI gate against drift; this is the same gate for the site.
//
// Usage: node scripts/check-tokens.mjs

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appCss = resolve(here, '../../web/src/app.css');
const siteCss = resolve(here, '../src/styles/site.css');

/** site token → the app token it must equal. Light theme only: it is the one
 *  both files declare at the top level, and a palette that agrees in light and
 *  disagrees in dark is not a failure mode that has ever occurred here. */
const MIRRORED = [
  { site: '--paper', app: '--background' },
  { site: '--card', app: '--card' },
  { site: '--ink', app: '--foreground' },
  { site: '--stamp', app: '--stamp' }
];

/**
 * Reads the custom properties from the FIRST top-level `:root` block.
 *
 * Two things a naive regex gets wrong here, both found by this gate failing
 * against a correct stylesheet on its first run:
 *
 *  - `[\s\S]*?\n\}` stops at the first line beginning with `}`, which truncates
 *    app.css's `:root` at its first nested rule and loses --stamp entirely.
 *    Braces are counted instead.
 *  - Both files declare `:root` a second time inside a
 *    `@media (prefers-color-scheme: dark)` block. Taking the last match read the
 *    DARK palette and reported every light token as drifted. Only the first,
 *    column-zero `:root` is the light theme.
 */
function readLightRoot(css) {
  const start = css.search(/^:root\s*\{/m);
  if (start === -1) throw new Error('no top-level :root block found');

  let depth = 0;
  let end = start;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  // Comments are stripped BEFORE matching declarations, and that is not
  // tidiness either. app.css documents --stamp with the line "Deliberately NOT
  // --primary: as the button fill it would compete with the photographs." A
  // declaration pattern reads `--primary:` there as a real token whose value
  // runs to the next semicolon — which is the end of the actual --stamp
  // declaration on the following line. The gate then reports --stamp as absent
  // from a file that plainly defines it. Prose in a stylesheet is data too.
  const declarations = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');

  const tokens = new Map();
  for (const [, name, value] of declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name, value.trim());
  }
  return tokens;
}

const app = readLightRoot(readFileSync(appCss, 'utf8'));
const site = readLightRoot(readFileSync(siteCss, 'utf8'));

const problems = [];
for (const { site: siteName, app: appName } of MIRRORED) {
  const want = app.get(appName);
  const got = site.get(siteName);
  if (!want) {
    problems.push(`web/src/app.css no longer defines ${appName} — this gate needs updating`);
    continue;
  }
  if (!got) {
    problems.push(`site.css no longer defines ${siteName}`);
    continue;
  }
  if (want.toLowerCase() !== got.toLowerCase()) {
    problems.push(`${siteName} is ${got} but the app's ${appName} is ${want}`);
  }
}

if (problems.length > 0) {
  console.error('\nThe marketing site has drifted from the app palette:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nUpdate site/src/styles/site.css so the site and the app render the same brand.\n');
  process.exit(1);
}

console.log(`site palette matches web/src/app.css (${MIRRORED.length} tokens checked)`);
