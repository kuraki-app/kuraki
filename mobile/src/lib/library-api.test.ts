import { describe, expect, it } from 'vitest';
import { isUnfiltered, routeForMutation } from '@/lib/library-api';

describe('routeForMutation', () => {
  it('favorite', () => {
    expect(routeForMutation('favorite', 'a1', JSON.stringify({ favorite: true })))
      .toEqual({ method: 'POST', path: '/api/assets/a1/favorite', body: { favorite: true } });
  });
  it('album_add', () => {
    expect(routeForMutation('album_add', 'a1', JSON.stringify({ album_id: 'al1' })))
      .toEqual({ method: 'POST', path: '/api/albums/al1/assets', body: { ids: ['a1'] } });
  });
  it('album_remove', () => {
    expect(routeForMutation('album_remove', 'a1', JSON.stringify({ album_id: 'al1' })))
      .toEqual({ method: 'DELETE', path: '/api/albums/al1/assets', body: { ids: ['a1'] } });
  });
  it('trash', () => {
    expect(routeForMutation('trash', 'a1', '{}'))
      .toEqual({ method: 'DELETE', path: '/api/assets/a1', body: undefined });
  });
  it('restore', () => {
    expect(routeForMutation('restore', 'a1', '{}'))
      .toEqual({ method: 'POST', path: '/api/assets/a1/restore', body: undefined });
  });
  it('purge', () => {
    expect(routeForMutation('purge', 'a1', '{}'))
      .toEqual({ method: 'DELETE', path: '/api/trash/a1', body: undefined });
  });
  it('set_tags maps to a full-set PUT', () => {
    expect(routeForMutation('set_tags', 'a1', JSON.stringify({ tag_ids: ['t1', 't2'] })))
      .toEqual({ method: 'PUT', path: '/api/assets/a1/tags', body: { ids: ['t1', 't2'] } });
  });
});

describe('isUnfiltered', () => {
  it('the plain timeline is cacheable', () => {
    expect(isUnfiltered({})).toBe(true);
  });

  it('the archived view is not', () => {
    // Caching it would write archived photos into the offline mirror of the
    // ordinary timeline, and the next cold start would open on them.
    expect(isUnfiltered({ archived: true })).toBe(false);
  });

  it('any other filter is not either', () => {
    expect(isUnfiltered({ favorite: true })).toBe(false);
    expect(isUnfiltered({ tag: 'beach' })).toBe(false);
  });
});
