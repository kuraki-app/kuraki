import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type ProxyOptions } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Ports come from ports.env, which `make ports` generates from
// internal/config/ports.go — the Go server owns the numbers. scripts/dev.sh
// exports them too, and the environment wins so `KURAKI_PORT=… npm run dev`
// still works; the file is the fallback for running Vite directly.
//
// Hardcoding the port here as well as in dev.sh meant moving one left the other
// pointing at whatever else held the old number — which, on a machine running
// another dev server, is not an error, just the wrong app's responses appearing
// in the Kuraki UI.
function portsFromFile(): Record<string, string> {
  try {
    const body = readFileSync(fileURLToPath(new URL('../ports.env', import.meta.url)), 'utf8');
    return Object.fromEntries(
      body
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => line.split('=') as [string, string])
    );
  } catch {
    return {};
  }
}

const ports = portsFromFile();
const apiPort = process.env.KURAKI_PORT ?? ports.KURAKI_PORT ?? '39175';
const webPort = Number(process.env.KURAKI_WEB_PORT ?? ports.KURAKI_WEB_PORT ?? '39176');
const api = `http://localhost:${apiPort}`;

/**
 * One proxy entry for every server-owned path, and the one option that makes
 * writes work at all.
 *
 * The server refuses browser cross-origin state changes by comparing the Origin
 * header against the Host the request arrived on (`sameOriginWrites`). Vite
 * rewrites Host to the proxy target by default, so the server saw Origin
 * `localhost:5173` arriving at Host `localhost:3000` and answered 403
 * `cross_origin_request` to every POST, PATCH and DELETE. Reads were unaffected,
 * so `npm run dev` looked healthy right up to the first write — first-run setup
 * could not complete at all, which is the very first thing the workflow asks you
 * to do.
 *
 * Keeping the browser's Host restores the pair the check is meant to compare.
 * It weakens nothing: in production the UI is embedded and served from the
 * server's own origin, where the check does its real work against a real
 * attacker's origin.
 */
const toAPI: ProxyOptions = { target: api, changeOrigin: false };

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // In `npm run dev` (used by scripts/dev.sh) the SvelteKit UI runs on :5173 and
  // the Go API on :3000. Proxy the server-owned paths so the hot-reloading UI
  // talks to the real backend without a rebuild. In production the UI is
  // embedded in the Go binary and served from the same origin, so this whole
  // block is a dev-only convenience.
  //
  // Every top-level path the Go router owns has to be listed. `/download` was
  // missing, so the Devices page's "Download the Android app (.apk)" link hit
  // SvelteKit instead of the server and 404'd in dev only — the one mode where
  // the two are not the same origin.
  server: {
    // Not Vite's 5173: that collides with every other Vite project on the
    // machine, and the point of this block is that a Kuraki dev session can run
    // beside anything else without either of them moving.
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': toAPI,
      '/healthz': toAPI,
      '/metrics': toAPI,
      '/download': toAPI
    }
  }
});
