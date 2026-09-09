import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type ProxyOptions } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// The API port is chosen by scripts/dev.sh and exported as KURAKI_PORT, so the
// server and this proxy cannot drift apart. Hardcoding 3000 in both meant
// `--addr :4000` moved the server and left the proxy pointing at whatever else
// was on 3000 — which on a machine running another dev server is not an error,
// just the wrong app's responses appearing in the Kuraki UI.
const apiPort = process.env.KURAKI_PORT ?? '3000';
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
    proxy: {
      '/api': toAPI,
      '/healthz': toAPI,
      '/metrics': toAPI,
      '/download': toAPI
    }
  }
});
