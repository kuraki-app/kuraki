import { describe, expect, it } from 'vitest';

import { decodeBase64Url, decodePairingURI, encodePairingURI } from '@/lib/pairing';

// The web app builds the payload with btoa(JSON.stringify(...)) and base64url
// escaping; these fixtures are what it actually emits.
const payload = { base_url: 'http://192.168.1.20:3000', code: 'abc-123_XYZ' };
const uri = encodePairingURI(payload);

describe('decodeBase64Url', () => {
  it('round-trips the web encoder output', () => {
    expect(JSON.parse(decodeBase64Url(uri.slice('kuraki://pair?d='.length)))).toEqual(payload);
  });

  it('decodes without padding', () => {
    // The web strips '=' padding; every unpadded length must still decode.
    expect(decodeBase64Url('YQ')).toBe('a');
    expect(decodeBase64Url('YWI')).toBe('ab');
    expect(decodeBase64Url('YWJj')).toBe('abc');
  });

  it('accepts the base64url alphabet', () => {
    // '-' and '_' stand in for '+' and '/'.
    expect(decodeBase64Url('Pz8_')).toBe('???');
    expect(decodeBase64Url('--__')).toBe(decodeBase64Url('++//'));
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => decodeBase64Url('not base64!')).toThrow();
  });
});

describe('decodePairingURI', () => {
  it('reads a payload produced by the web app', () => {
    expect(decodePairingURI(uri)).toEqual(payload);
  });

  it('matches the web app’s btoa encoder exactly', () => {
    // The contract between the two surfaces. web/src/routes/settings/devices
    // builds the payload as base64url(btoa(JSON.stringify(...))); this rebuilds
    // it with the real btoa so the fixtures above can't drift into agreeing
    // only with our own encoder.
    const web = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    for (const p of [
      { base_url: 'http://192.168.1.20:3000', code: 'abc-123_XYZ' },
      { base_url: 'https://photos.example.com', code: 'a'.repeat(43) },
      { base_url: 'http://10.0.0.5:3000/kuraki', code: '+/slash+plus/' },
    ]) {
      const fromWeb = `kuraki://pair?d=${web(JSON.stringify(p))}`;
      expect(decodePairingURI(fromWeb)).toEqual(p);
      expect(fromWeb).toBe(encodePairingURI(p));
    }
  });

  it('names a non-Kuraki QR code distinctly', () => {
    // Scanning a wifi/vcard/URL QR is the common user error and must not be
    // reported the same way as a corrupt Kuraki code.
    expect(() => decodePairingURI('https://example.com')).toThrow(/not a Kuraki pairing code/i);
  });

  it('names a damaged Kuraki code distinctly', () => {
    expect(() => decodePairingURI('kuraki://pair?d=@@@@')).toThrow(/damaged|incomplete/i);
    expect(() => decodePairingURI('kuraki://pair?d=' + encodeURIComponent('nonsense'))).toThrow(
      /damaged|incomplete/i,
    );
  });

  it('rejects a payload missing its fields', () => {
    const half = encodePairingURI({ base_url: 'http://x:3000', code: '' });
    expect(() => decodePairingURI(half)).toThrow(/damaged|incomplete/i);
  });

  it('rejects a server address the phone can never reach', () => {
    // The single most common self-hosting mistake: the owner has the web UI
    // open on localhost, so the QR embeds an address that resolves to the
    // phone itself. Fail with an explanation instead of a bare network error.
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const loopback = encodePairingURI({ base_url: `http://${host}:3000`, code: 'abc' });
      expect(() => decodePairingURI(loopback)).toThrow(/localhost|loopback|this phone/i);
    }
  });
});
