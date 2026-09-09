import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// The API port is chosen by scripts/dev.sh and exported as KURAKI_PORT, so the
// server and this proxy cannot drift apart. Hardcoding 3000 in both meant
// `--addr :4000` moved the server and left the proxy pointing at whatever else
// was on 3000 — which on a machine running another dev server is not an error,
// just the wrong app's responses appearing in the Kuraki UI.
const apiPort = process.env.KURAKI_PORT ?? '3000';
const api = `http://localhost:${apiPort}`;

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // In `npm run dev` (used by scripts/dev.sh) the SvelteKit UI runs on :5173 and
  // the Go API on :3000. Proxy the server-owned paths so the hot-reloading UI
  // talks to the real backend without CORS or a rebuild. In production the UI is
  // embedded in the Go binary and served from the same origin, so this is a
  // dev-only convenience.
  //
  // Every top-level path the Go router owns has to be listed. `/download` was
  // missing, so the Devices page's "Download the Android app (.apk)" link hit
  // SvelteKit instead of the server and 404'd in dev only — the one mode where
  // the two are not the same origin.
  server: {
    proxy: {
      '/api': api,
      '/healthz': api,
      '/metrics': api,
      '/download': api
    }
  }
});
