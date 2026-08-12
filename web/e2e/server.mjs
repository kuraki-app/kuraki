// Boots a real Kuraki server against a throwaway library for the e2e suite.
//
// Deliberately the Go binary, not `vite dev`. The SPA is served by
// `internal/httpapi` under a strict CSP with a per-request script nonce
// (`spaHandler`/`serveSPADocument`), and the whole app boots or fails to boot on
// that path. Testing through Vite's dev server would exercise a document that
// production never serves — and the CSP nonce is exactly the kind of thing that
// only breaks in the real one.
//
// Seeding order is load-bearing: `kuraki import` on a fresh data directory
// creates a PLACEHOLDER owner (username "owner", empty password), and
// `POST /api/setup` later claims that same row (see the comment in
// `internal/httpapi/auth.go:63`). So importing first and running first-run setup
// through the UI afterwards leaves the seeded assets owned by the account the
// tests sign in as. Reversing the order would sign you in to an empty library.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFixtures } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// Not exported: importing this module runs it. The port is agreed with
// playwright.config.ts through the environment rather than through an import,
// so reading the config can never start a server as a side effect.
const PORT = Number(process.env.KURAKI_E2E_PORT ?? 3456);

const BINARY = join(repoRoot, 'bin', 'kuraki');
const DATA_DIR = join(here, '.tmp', 'data');
const FIXTURE_DIR = join(here, '.tmp', 'fixtures');

function die(message) {
  console.error(`\ne2e: ${message}\n`);
  process.exit(1);
}

if (!existsSync(BINARY)) {
  die(`no server binary at ${BINARY}. Run \`make e2e\` from the repo root.`);
}

// Guard against testing a UI nobody is editing. The binary serves the COMMITTED
// `internal/httpapi/assets` via go:embed, so editing web/src and running the
// suite proves nothing about the change unless `make web` rebuilt the assets and
// `make build` re-embedded them. Nothing else in the repo checks this — it is
// the same drift hole AGENTS.md §11 records for releases — so check it here
// rather than let a green run vouch for code that was never served.
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

const binaryBuilt = statSync(BINARY).mtimeMs;
const sourceTouched = newestMtime(join(repoRoot, 'web', 'src'));
if (sourceTouched > binaryBuilt) {
  die(
    'web/src is newer than bin/kuraki, so the server would serve a stale UI.\n' +
      'Run `make e2e` (rebuilds the embedded assets and the binary), or\n' +
      '`make web && make build` by hand before `npm run test:e2e`.'
  );
}

// A stale library from a previous run would make every count assertion lie, and
// re-running setup against a claimed owner returns 409 setup_already_complete.
rmSync(join(here, '.tmp'), { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });

const written = writeFixtures(FIXTURE_DIR);

const env = { ...process.env, KURAKI_DATA_DIR: DATA_DIR, KURAKI_ADDR: `127.0.0.1:${PORT}` };

const seed = spawnSync(BINARY, ['import', FIXTURE_DIR], { env, encoding: 'utf8' });
if (seed.status !== 0) {
  die(`seed import failed (exit ${seed.status}):\n${seed.stderr ?? ''}`);
}

// Assert the importer agrees with what we wrote. If the fixtures ever stop being
// byte-distinct they collapse to one asset via BLAKE3 dedup, and every test that
// counts tiles would still pass — silently, against a library of size 1.
//
// Match the final summary line, not a bare `imported=`: the progress bar writes
// a running `imported=N` for every file into this same stream, so a loose
// pattern reads the first tick (`imported=1`) and reports a 36-file seed as one.
const summary = /scanned=(\d+) imported=(\d+) skipped=(\d+) duplicates=(\d+) errors=(\d+)/.exec(
  seed.stdout
);
if (!summary) die(`could not parse the import summary from:\n${seed.stdout.trim()}`);

const [, scanned, imported, , duplicates, errors] = summary.map(Number);
if (Number(imported) !== written || Number(duplicates) !== 0 || Number(errors) !== 0) {
  die(
    `seeded ${written} files but got scanned=${scanned} imported=${imported} ` +
      `duplicates=${duplicates} errors=${errors}.\n` +
      `duplicates>0 means the fixtures are no longer byte-distinct, and every ` +
      `count assertion downstream would pass vacuously against a smaller library.`
  );
}
console.log(`e2e: seeded ${imported} assets into ${DATA_DIR}`);

const server = spawn(BINARY, ['serve'], { env, stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.kill(signal);
  });
}
