// The app-only QR format the web app emits: `kuraki://pair?d=<base64url(JSON)>`.
// The payload is deliberately opaque so a generic QR reader reveals nothing
// usable — only this app knows to decode it.
export const PAIR_PREFIX = 'kuraki://pair?d=';

export type PairingPayload = { base_url: string; code: string };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * decodeBase64Url decodes the web app's base64url payload without `atob`.
 *
 * `atob` is a browser global. React Native does not polyfill it (nothing in the
 * react-native package defines it) — it exists only if the engine happens to,
 * and TypeScript accepts it here purely because `@types/node`/`lib.dom` are on
 * the path. Relying on it made a possible engine difference surface as
 * "that QR code is not a Kuraki pairing code", pointing at the wrong thing.
 *
 * Returns a byte string, mirroring `atob`: the web side builds the payload with
 * `btoa`, which itself refuses anything outside Latin-1, so the two ends agree.
 */
export function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  let accumulator = 0;
  let bits = 0;
  let out = '';
  for (const char of normalized) {
    if (char === '=') break; // padding: the web strips it, but accept it too
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`unexpected character ${JSON.stringify(char)} in base64`);
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((accumulator >> bits) & 0xff);
    }
  }
  return out;
}

/** encodePairingURI mirrors the web app's encoder. Used by the tests as the fixture source. */
export function encodePairingURI(payload: PairingPayload): string {
  const json = JSON.stringify(payload);
  let base64 = '';
  for (let i = 0; i < json.length; i += 3) {
    const [a, b, c] = [json.charCodeAt(i), json.charCodeAt(i + 1), json.charCodeAt(i + 2)];
    const triple = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
    base64 += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    base64 += isNaN(b) ? '' : ALPHABET[(triple >> 6) & 63];
    base64 += isNaN(c) ? '' : ALPHABET[triple & 63];
  }
  return PAIR_PREFIX + base64.replace(/\+/g, '-').replace(/\//g, '_');
}

// A phone that connects to loopback connects to itself. This is the most common
// self-hosting mistake — the owner generates the QR with the web UI open on
// localhost — and it otherwise surfaces as an opaque network failure well after
// the scan, where nothing points at the address being the problem.
function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

/**
 * decodePairingURI reads a scanned QR into the server URL and the one-time code
 * the phone redeems for its own device token. Each failure mode is reported
 * distinctly so a failed pair names its own cause.
 */
export function decodePairingURI(data: string): PairingPayload {
  if (!data.startsWith(PAIR_PREFIX)) {
    throw new Error('That QR code is not a Kuraki pairing code. Scan the one in Kuraki › Devices.');
  }
  const damaged = new Error('This Kuraki QR code is damaged or incomplete. Generate a new one.');

  let payload: { base_url?: unknown; code?: unknown };
  try {
    payload = JSON.parse(decodeBase64Url(data.slice(PAIR_PREFIX.length)));
  } catch {
    throw damaged;
  }
  const baseURL = typeof payload.base_url === 'string' ? payload.base_url : '';
  const code = typeof payload.code === 'string' ? payload.code : '';
  if (!baseURL || !code) throw damaged;

  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw damaged;
  }
  if (isLoopback(parsed.hostname)) {
    throw new Error(
      `This code points at ${parsed.host}, which means "this phone" — not your server. ` +
        'Open Kuraki on your computer using its network address, then generate a new code.',
    );
  }
  return { base_url: baseURL, code };
}
