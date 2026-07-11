import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // In `npm run dev` (used by scripts/dev.sh) the SvelteKit UI runs on :5173 and
  // the Go API on :3000. Proxy the server-owned paths so the hot-reloading UI
  // talks to the real backend without CORS or a rebuild. In production the UI is
  // embedded in the Go binary and served from the same origin, so this is a
  // dev-only convenience.
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
      '/metrics': 'http://localhost:3000'
    }
  }
});
