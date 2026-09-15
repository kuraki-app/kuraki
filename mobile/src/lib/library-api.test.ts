import { videoSource, fullImageSource, thumbSource, type LibraryAsset } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';
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


const connection: CaptureSettings = { baseURL: 'https://photos.example.test', deviceToken: 'test-device' };
const video: LibraryAsset = { id: 'video', filename: 'clip.mov', media_type: 'video', favorite: false, web_viewable: true };

it('plays the authenticated server derivative for an incompatible original', () => {
  expect(videoSource(connection, { ...video, preview_url: '/api/assets/video/preview' })).toEqual({
    uri: 'https://photos.example.test/api/assets/video/preview',
    headers: { Authorization: 'Bearer test-device' },
  });
  expect(videoSource(connection, video)?.uri).toMatch(/\/original$/);
  expect(videoSource(connection, { ...video, web_viewable: false })).toBeNull();
});

it('keeps a thumbnail fallback for an image without a full preview', () => {
  expect(fullImageSource(connection, { ...video, media_type: 'image', web_viewable: false, thumbnail_url: '/thumb' })?.uri).toMatch(/\/thumb$/);
});

it('uses the versioned tier URL the server sent', () => {
  const photo: LibraryAsset = {
    id: 'p', filename: 'p.jpg', media_type: 'image', favorite: false, web_viewable: true,
    thumbnail_url: '/api/assets/p/thumb?v=abc',
    thumbnail_urls: { s: '/api/assets/p/thumb?size=s&v=abc', m: '/api/assets/p/thumb?v=abc', l: '/api/assets/p/thumb?size=l&v=abc' },
  };
  expect(thumbSource(connection, photo, 'l')?.uri).toBe('https://photos.example.test/api/assets/p/thumb?size=l&v=abc');
  expect(thumbSource(connection, photo)?.uri).toBe('https://photos.example.test/api/assets/p/thumb?v=abc');
  expect(thumbSource(connection, photo, 's')?.headers).toEqual({ Authorization: 'Bearer test-device' });
});

it('falls back to the id route for synthetic cover stubs', () => {
  const stub: LibraryAsset = { id: 'c', filename: '', media_type: 'image', favorite: false, web_viewable: false, thumbnail_url: 'c' };
  expect(thumbSource(connection, stub, 'l')?.uri).toBe('https://photos.example.test/api/assets/c/thumb');
});

it('keeps the preview version for playback', () => {
  expect(videoSource(connection, { ...video, preview_url: '/api/assets/video/preview?v=abc' })?.uri)
    .toBe('https://photos.example.test/api/assets/video/preview?v=abc');
});
