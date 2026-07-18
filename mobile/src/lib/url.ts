// normalizeServerURL turns operator input (often a bare LAN IP) into a usable
// origin. A bare host gets http:// and Kuraki's default :3000; an explicit
// scheme is respected and left portless. A meaningful path (e.g. a reverse-proxy
// subpath like /kuraki) is preserved; a lone trailing slash is stripped so the
// result concatenates cleanly with `/api/...` paths elsewhere.
export function normalizeServerURL(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter your server address.');

  const hasScheme = /^https?:\/\//i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('That does not look like a valid address.');
  }
  if (!url.hostname) throw new Error('That does not look like a valid address.');

  // Only default the port for a bare host the user typed without a scheme.
  if (!hasScheme && !url.port) {
    url.port = '3000';
  }

  // Preserve a real subpath (reverse-proxy deployments); drop a lone "/".
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}
