import AsyncStorage from '@react-native-async-storage/async-storage';

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

const recentCacheKey = 'kuraki.library.recent.v1';

export class LibraryError extends Error {}

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
    throw new LibraryError('This device was disconnected. Re-pair it in Settings.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new LibraryError(typeof body.error === 'string' ? body.error : `Request failed (${response.status})`);
  }
  return (await response.json()) as LibraryPage;
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

// A small slice of the most recent items is cached so the grid paints instantly
// on open, before the network responds — the offline-cache half of the Find job.
export async function loadCachedRecent(): Promise<LibraryAsset[]> {
  const raw = await AsyncStorage.getItem(recentCacheKey);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LibraryAsset[];
  } catch {
    return [];
  }
}

export async function saveCachedRecent(assets: LibraryAsset[]): Promise<void> {
  await AsyncStorage.setItem(recentCacheKey, JSON.stringify(assets.slice(0, 60)));
}
