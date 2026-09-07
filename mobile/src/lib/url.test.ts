import { describe, expect, it } from 'vitest';
import { normalizeServerURL, serverHost } from '@/lib/url';

describe('normalizeServerURL', () => {
  it('adds http and default port to a bare IP', () => {
    expect(normalizeServerURL('192.168.1.40')).toBe('http://192.168.1.40:3000');
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
    expect(normalizeServerURL('  192.168.1.40  ')).toBe('http://192.168.1.40:3000');
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
    expect(normalizeServerURL('192.168.1.40/')).toBe('http://192.168.1.40:3000');
  });
  it('throws on a scheme with no host', () => {
    expect(() => normalizeServerURL('http://')).toThrow();
  });
});

describe('serverHost', () => {
  it('drops the scheme', () => {
    expect(serverHost('https://photos.home.lan')).toBe('photos.home.lan');
    expect(serverHost('http://photos.home.lan')).toBe('photos.home.lan');
  });

  it('keeps a port that distinguishes servers', () => {
    expect(serverHost('http://192.168.1.20:3000')).toBe('192.168.1.20:3000');
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
