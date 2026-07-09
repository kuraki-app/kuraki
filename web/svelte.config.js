import adapter from '@sveltejs/adapter-static';

const config = {
  kit: {
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
