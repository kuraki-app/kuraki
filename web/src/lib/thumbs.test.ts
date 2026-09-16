import { describe, expect, it } from 'vitest';
import { thumbSrcset } from './thumbs';

describe('thumbSrcset', () => {
  it('lists every tier with its width descriptor', () => {
    expect(thumbSrcset({ thumbnail_urls: { s: '/s', m: '/m', l: '/l' } })).toBe('/s 256w, /m 512w, /l 1200w');
  });

  it('omits srcset when the server sent no tiers', () => {
    expect(thumbSrcset({})).toBeUndefined();
  });
});
