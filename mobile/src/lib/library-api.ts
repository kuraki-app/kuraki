import AsyncStorage from '@react-native-async-storage/async-storage';

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
  thumbnail_url?: string | null;
  place_city?: string;
  place_country?: string;
};

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
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new LibraryError(typeof body.error === 'string' ? body.error : `Request failed (${response.status})`);
  }
  return (await response.json()) as LibraryPage;
}

/** thumbSource builds an authenticated expo-image source, or null when no thumbnail exists. */
export function thumbSource(
  settings: CaptureSettings,
  asset: LibraryAsset,
): { uri: string; headers: Record<string, string> } | null {
  if (!asset.thumbnail_url || !settings.baseURL) return null;
  return {
    uri: `${settings.baseURL}/api/capture/assets/${asset.id}/thumb`,
    headers: { Authorization: `Bearer ${settings.deviceToken}` },
  };
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
