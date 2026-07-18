import { upsertAssets } from '@/lib/cache/assets';
import { flushMutations, type PendingMutation } from '@/lib/cache/mutations';
import { reportAuthLost } from '@/lib/session';
import type { CaptureSettings } from '@/lib/settings';

// The mobile Find loop reads the library through the device-authenticated
// endpoints, which speak the same filter language as the web UI.

export type LibraryAsset = {
  id: string;
  filename: string;
  media_type: string;
  taken_at?: string;
  taken_day?: string;
  favorite: boolean;
  web_viewable?: boolean;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  place_city?: string;
  place_country?: string;
};

type AuthedSource = { uri: string; headers: Record<string, string> };

export type LibraryPage = { assets: LibraryAsset[]; next_cursor?: string };

export type LibraryFilters = {
  q?: string;
  type?: 'image' | 'video';
  favorite?: boolean;
  from?: string;
  to?: string;
  place_city?: string;
};

export class LibraryError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = 'LibraryError';
  }
}

// A page is "unfiltered" when it is the plain recent view (no search, type,
// favorite, date range, or place filter) — that's the only view worth caching
// for instant paint on the next open / offline fallback.
function isUnfiltered(filters: LibraryFilters): boolean {
  return !filters.q && !filters.type && !filters.favorite && !filters.from && !filters.to && !filters.place_city;
}

export async function fetchLibrary(
  settings: CaptureSettings,
  filters: LibraryFilters,
  cursor?: string,
): Promise<LibraryPage> {
  if (!settings.baseURL || !settings.deviceToken) {
    throw new LibraryError('Connect this device in Settings first.');
  }
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.type) params.set('type', filters.type);
  if (filters.favorite) params.set('favorite', '1');
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.place_city) params.set('place_city', filters.place_city);
  if (cursor) params.set('cursor', cursor);

  const response = await fetch(`${settings.baseURL}/api/capture/library?${params.toString()}`, {
    headers: { Authorization: `Bearer ${settings.deviceToken}` },
  });
  if (response.status === 401) {
    reportAuthLost();
    throw new LibraryError('This device was disconnected. Re-pair it in Settings.', 401);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new LibraryError(
      typeof body.error === 'string' ? body.error : `Request failed (${response.status})`,
      response.status,
    );
  }
  const page = (await response.json()) as LibraryPage;
  // Feed the offline cache from the plain recent view so the grid can paint
  // instantly next open and fall back to something when the network is down.
  if (isUnfiltered(filters)) void upsertAssets(page.assets);
  return page;
}

/** setFavorite pushes a favorite toggle to the server for one asset. */
export async function setFavorite(settings: CaptureSettings, id: string, favorite: boolean): Promise<void> {
  const response = await fetch(`${settings.baseURL}/api/capture/assets/${id}/favorite`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite }),
  });
  if (response.status === 401) {
    reportAuthLost();
    throw new LibraryError('This device was disconnected. Re-pair it in Settings.', 401);
  }
  if (!response.ok) {
    throw new LibraryError(`Could not update favorite (${response.status})`, response.status);
  }
}

// flushFavorites drains the offline favorite queue over a reconnected link. Each
// queued write maps to the {status, networkError} shape flushMutations expects:
// a clean send is a 200, a 401 (device re-revoked mid-flush) is reported
// explicitly, anything else thrown by fetch itself is a network error worth
// retrying later. Shared by Settings (on Save) and Library (on recovery) so the
// send shape lives in exactly one place.
export async function flushFavorites(settings: CaptureSettings): Promise<void> {
  const send = async (m: PendingMutation) => {
    try {
      const { favorite } = JSON.parse(m.payload) as { favorite: boolean };
      await setFavorite(settings, m.asset_id, favorite);
      return { status: 200, networkError: false };
    } catch (cause) {
      if (cause instanceof LibraryError) {
        return { status: cause.status, networkError: false };
      }
      return { status: 0, networkError: true };
    }
  };
  await flushMutations(send);
}

function authed(settings: CaptureSettings, id: string, kind: 'thumb' | 'preview' | 'original'): AuthedSource {
  return {
    uri: `${settings.baseURL}/api/capture/assets/${id}/${kind}`,
    headers: { Authorization: `Bearer ${settings.deviceToken}` },
  };
}

/** thumbSource builds an authenticated expo-image source, or null when no thumbnail exists. */
export function thumbSource(settings: CaptureSettings, asset: LibraryAsset): AuthedSource | null {
  if (!asset.thumbnail_url || !settings.baseURL) return null;
  return authed(settings, asset.id, 'thumb');
}

/**
 * fullImageSource picks the best full-size image the phone can display: a
 * browser-safe preview derivative if one exists, otherwise the original when it
 * is web-viewable, otherwise the thumbnail as a last resort.
 */
export function fullImageSource(settings: CaptureSettings, asset: LibraryAsset): AuthedSource | null {
  if (!settings.baseURL) return null;
  if (asset.preview_url) return authed(settings, asset.id, 'preview');
  if (asset.web_viewable) return authed(settings, asset.id, 'original');
  return thumbSource(settings, asset);
}

/** videoSource returns the authenticated original for playback. */
export function videoSource(settings: CaptureSettings, asset: LibraryAsset): AuthedSource | null {
  if (!settings.baseURL) return null;
  return authed(settings, asset.id, 'original');
}
