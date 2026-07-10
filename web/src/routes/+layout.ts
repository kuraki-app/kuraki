// Pure client-side SPA: no SSR, no prerendering. The Go server serves the
// embedded index.html for every route and the client router takes over, which
// supports dynamic routes like /albums/[id].
export const ssr = false;
export const prerender = false;
