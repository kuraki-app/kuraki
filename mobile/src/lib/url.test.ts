import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVER_PORT as PORT } from '@/design/ports';
import { normalizeServerURL, serverHost, serverURLCandidates } from '@/lib/url';

// The port is read from the generated constant, not written here: these tests
// pin the *rule* (a local address gets the server's own port, a domain gets
// HTTPS), and moving the server's port should not require editing assertions.

describe('normalizeServerURL', () => {
  it('adds http and default port to a bare IP', () => {
    expect(normalizeServerURL('192.168.1.40')).toBe(`http://192.168.1.40:${PORT}`);
  });
  it('keeps an explicit port', () => {
    expect(normalizeServerURL('192.168.1.40:8080')).toBe('http://192.168.1.40:8080');
  });
  it('keeps an explicit https scheme and does not add a port', () => {
    expect(normalizeServerURL('https://photos.example.com')).toBe('https://photos.example.com');
  });
  it('strips trailing slashes', () => {
    expect(normalizeServerURL('http://host:3000/')).toBe('http://host:3000');
  });
  it('trims whitespace', () => {
    expect(normalizeServerURL('  192.168.1.40  ')).toBe(`http://192.168.1.40:${PORT}`);
  });
  it('throws on empty', () => {
    expect(() => normalizeServerURL('   ')).toThrow();
  });
  it('preserves a reverse-proxy subpath', () => {
    expect(normalizeServerURL('https://example.com/kuraki')).toBe('https://example.com/kuraki');
  });
  it('strips a trailing slash from a subpath', () => {
    expect(normalizeServerURL('https://example.com/kuraki/')).toBe('https://example.com/kuraki');
  });
  it('drops a lone root slash', () => {
    expect(normalizeServerURL('192.168.1.40/')).toBe(`http://192.168.1.40:${PORT}`);
  });
  it('throws on a scheme with no host', () => {
    expect(() => normalizeServerURL('http://')).toThrow();
  });
});

describe('serverURLCandidates', () => {
  // The bug this exists for: every scheme-less address became http://host:3000,
  // so the reverse-proxy deployment DEPLOYMENT.md documents was unreachable
  // from the app — and on iOS not merely wrong but blocked, since App Transport
  // Security permits cleartext on the local network only.
  it('assumes HTTPS on 443 for a public-looking domain', () => {
    expect(serverURLCandidates('photos.example.com')[0]).toBe('https://photos.example.com');
  });

  it('still assumes plain HTTP on 3000 for anything that can only be local', () => {
    for (const local of ['192.168.1.40', 'nas', 'kuraki.local', 'photos.home.lan', 'box.internal']) {
      expect(serverURLCandidates(local)[0]).toBe(`http://${local}:${PORT}`);
    }
  });

  it('offers the other scheme second, so a guess that is wrong is recoverable', () => {
    expect(serverURLCandidates('photos.example.com')).toEqual([
      'https://photos.example.com',
      `http://photos.example.com:${PORT}`,
    ]);
    expect(serverURLCandidates('192.168.1.40')).toEqual([
      `http://192.168.1.40:${PORT}`,
      'https://192.168.1.40',
    ]);
  });

  it('treats a stated scheme as an instruction, not a guess', () => {
    expect(serverURLCandidates('https://photos.example.com')).toEqual(['https://photos.example.com']);
    expect(serverURLCandidates('http://192.168.1.40:8080')).toEqual(['http://192.168.1.40:8080']);
  });

  it('keeps a stated port on both schemes, and never overrides it with the default', () => {
    expect(serverURLCandidates('photos.example.com:8443')).toEqual([
      'http://photos.example.com:8443',
      'https://photos.example.com:8443',
    ]);
  });

  it('carries a reverse-proxy subpath onto every candidate', () => {
    expect(serverURLCandidates('photos.example.com/kuraki')).toEqual([
      'https://photos.example.com/kuraki',
      `http://photos.example.com:${PORT}/kuraki`,
    ]);
  });

  it('keeps an IPv6 literal bracketed', () => {
    expect(serverURLCandidates('[fd00::1]')[0]).toBe(`http://[fd00::1]:${PORT}`);
  });
});

describe('serverHost', () => {
  it('drops the scheme', () => {
    expect(serverHost('https://photos.home.lan')).toBe('photos.home.lan');
    expect(serverHost('http://photos.home.lan')).toBe('photos.home.lan');
  });

  it('keeps a port that distinguishes servers', () => {
    expect(serverHost(`http://192.168.1.20:${PORT}`)).toBe(`192.168.1.20:${PORT}`);
  });

  it('drops a port that distinguishes nothing', () => {
    expect(serverHost('https://photos.home.lan:443')).toBe('photos.home.lan');
    expect(serverHost('http://photos.home.lan:80')).toBe('photos.home.lan');
  });

  it('drops a path', () => {
    expect(serverHost('https://photos.home.lan/settings')).toBe('photos.home.lan');
  });

  it('is empty for an unset address', () => {
    expect(serverHost('')).toBe('');
    expect(serverHost('   ')).toBe('');
  });
});
