import { DEFAULT_SERVER_PORT } from '@/design/ports';

// normalizeServerURL turns operator input (often a bare LAN IP) into a usable
// origin. A bare host gets a scheme and, on a local network, Kuraki's default
// :3000; an explicit scheme is respected and left portless. A meaningful path
// (e.g. a reverse-proxy subpath like /kuraki) is preserved; a lone trailing
// slash is stripped so the result concatenates cleanly with `/api/...` paths
// elsewhere.

/**
 * isLocalHostname reports whether a hostname can only mean "on this network".
 *
 * This is the whole difference between the two ways Kuraki is reached. A LAN
 * server is an address with a port — `192.168.1.40:3000`, plain HTTP, because
 * there is no certificate for a private IP. A server on the internet is a
 * domain on 443 behind a reverse proxy that terminates TLS. Guessing the same
 * scheme and port for both is wrong for one of them every time.
 *
 * Literal addresses and single-label names ("nas", "kuraki") cannot be resolved
 * publicly, and the mDNS/router suffixes below are reserved for local use.
 */
function isLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // IPv4 literal
  if (host.includes(':')) return true; // IPv6 literal
  if (!host.includes('.')) return true; // single label: "nas", "kuraki", "localhost"
  return /\.(local|lan|home|internal|localdomain)$/.test(host);
}

/** Re-attaches brackets to an IPv6 literal so it can sit in a URL. */
function asAuthority(hostname: string, port?: string): string {
  const bare = hostname.replace(/^\[|\]$/g, '');
  const host = bare.includes(':') ? `[${bare}]` : bare;
  return port ? `${host}:${port}` : host;
}

/**
 * serverURLCandidates returns the addresses worth trying for what someone
 * typed, best guess first.
 *
 * There is more than one because a bare hostname is genuinely ambiguous and the
 * app used to resolve that ambiguity the same way every time: everything
 * without a scheme became `http://<host>:3000`. That is right for the LAN and
 * wrong for every server on the internet, where the address is a domain on 443.
 * Someone typing `photos.example.com` — exactly what the reverse-proxy
 * deployment in DEPLOYMENT.md tells them to set up — got `http://photos.
 * example.com:3000`, which iOS then refused outright (App Transport Security
 * permits cleartext on the local network only), and the screen reported that
 * their correctly-typed domain could not be reached.
 *
 * An explicit scheme, or an explicit port, is an instruction rather than a
 * guess, so those narrow the list instead of widening it.
 */
export function serverURLCandidates(input: string): string[] {
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

  // Preserve a real subpath (reverse-proxy deployments); drop a lone "/".
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const at = (scheme: string, port?: string) => `${scheme}//${asAuthority(url.hostname, port)}${path}`;

  // Stated outright: use it, and only it.
  if (hasScheme) return [at(url.protocol, url.port || undefined)];

  // A port was chosen deliberately; only the scheme is still open, and a
  // non-default port is far more often a plain-HTTP server than a TLS one.
  if (url.port) return [at('http:', url.port), at('https:', url.port)];

  // A name that cannot resolve on the public internet is a LAN server: HTTP on
  // Kuraki's own port. HTTPS second, for a LAN server someone fronted with a
  // certificate anyway.
  if (isLocalHostname(url.hostname)) return [at('http:', DEFAULT_SERVER_PORT), at('https:')];

  // A public-looking domain: HTTPS on 443, the shape DEPLOYMENT.md produces.
  // Plain HTTP on the server's own port second, for one exposed without a proxy.
  return [at('https:'), at('http:', DEFAULT_SERVER_PORT)];
}

/**
 * describeAddressGuess says what will be done with what has been typed so far.
 *
 * It exists as a function, and is tested, because this sentence has been wrong
 * twice. It promised ":3000 will be added automatically" for every input, which
 * was a lie for a domain behind a reverse proxy; and once that was fixed it
 * called a half-typed `192.168.2` a public domain and offered HTTPS, because it
 * tested for a *complete* dotted quad. Someone typing a LAN address sees this
 * line the entire time they are typing, so it has to be right at every prefix,
 * not only at the end.
 */
export function describeAddressGuess(input: string, port: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return `A local address gets port ${port} automatically; a domain name is tried over HTTPS first.`;
  }
  const bare = trimmed.replace(/^\w+:\/\//, '');
  const host = bare.split('/')[0];
  if (/^https?:\/\//i.test(trimmed) || /:\d+/.test(host)) {
    return 'Using the address exactly as you entered it.';
  }
  // Digits and dots only: an IPv4 address, however much of it has been typed.
  // Anything shorter than four octets is still on its way to being one.
  const partialIP = /^[\d.]+$/.test(host);
  const localSuffix = /\.(local|lan|home|internal|localdomain)$/.test(host);
  const looksPublic = !partialIP && !localSuffix && host.includes('.');
  return looksPublic ? `Trying https:// first, then port ${port}.` : `Port ${port} will be added automatically.`;
}

/**
 * normalizeServerURL is the single best guess for what was typed — the first
 * candidate. Callers that can afford to probe should use `resolveServerURL`
 * (lib/connection.ts), which tries the rest before reporting failure.
 */
export function normalizeServerURL(input: string): string {
  return serverURLCandidates(input)[0];
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
