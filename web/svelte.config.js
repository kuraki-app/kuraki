import adapter from '@sveltejs/adapter-static';

const config = {
  kit: {
    // SvelteKit's default version name is `Date.now()`, and it is baked into the
    // client bundle — so every build produced a different timestamp, every chunk
    // hash changed, and `internal/httpapi/assets` (which is COMMITTED, because
    // go:embed reads it from the tree) churned ~100 files on every single build
    // regardless of whether any source changed. That made the embedded UI
    // impossible to review in a diff and impossible to gate in CI.
    //
    // The version is only consumed by SvelteKit's `updated` store, for detecting
    // that a new deployment exists. Nothing in web/src imports it — the app ships
    // inside the server binary, so "a new version" and "a new binary" are the
    // same event. Pinning it makes the build reproducible: identical source now
    // produces byte-identical assets, which is what lets CI check the committed
    // UI against a fresh build.
    version: { name: 'kuraki' },
    adapter: adapter({
      pages: '../internal/httpapi/assets',
      assets: '../internal/httpapi/assets',
      fallback: 'index.html',
      precompress: false,
      strict: true
    })
  }
};

export default config;
