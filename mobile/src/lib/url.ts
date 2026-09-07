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

/**
 * serverHost reduces a stored base URL to the host a person would say out loud:
 * "photos.home.lan", "192.168.1.20:3000".
 *
 * Settings shows this beside the reachability dot, where the useful fact is
 * *which* server is answering — the scheme is noise there, and a full URL
 * wraps in the space available. The port survives only when it is not the
 * scheme's default, because ":3000" distinguishes two servers on one host while
 * ":443" never distinguishes anything.
 *
 * Falls back to the raw input rather than throwing: this is a label, and a
 * settings screen that crashes because a hand-typed address is malformed is
 * worse than one that shows the address as typed.
 */
export function serverHost(baseURL: string): string {
  const trimmed = baseURL.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(normalizeServerURL(trimmed));
    const isDefaultPort =
      !url.port || (url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80');
    return isDefaultPort ? url.hostname : `${url.hostname}:${url.port}`;
  } catch {
    return trimmed;
  }
}
