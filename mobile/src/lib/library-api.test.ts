import { describe, expect, it } from 'vitest';
import { routeForMutation } from '@/lib/library-api';

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
});
