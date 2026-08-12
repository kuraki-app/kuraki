// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The canonical origin, in ONE place.
//
// `kuraki.app` is not registered yet and the site is live at kuraki.pages.dev.
// The hand-written index.html hardcoded https://kuraki.app/ into its canonical
// link, og:url and og:image, so the deployed page advertised a canonical URL
// that does not resolve and an OG image that 404s — which is why robots.txt
// closes crawling (see public/robots.txt).
//
// Everything derives from `site` below: canonical links, og:url, og:image, and
// the generated sitemap. Binding the real domain is a one-line change here plus
// opening robots.txt.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://kuraki.pages.dev',
  // Static output, no server, no client JS unless a page asks for it. The
  // output is still a folder of files that can be hosted anywhere — the
  // property the hand-written page had, kept.
  output: 'static',
  outDir: './dist',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  build: { format: 'directory' }
});
