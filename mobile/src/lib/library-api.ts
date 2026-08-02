import { flushMutations, type PendingMutation } from '@/lib/cache/mutations';
import { upsertAssets, getSyncCursor, setSyncCursor } from '@/lib/cache/assets';
import { upsertAlbums, readAlbums, setAlbumAssets, readAlbumAssets, setTrashed, readTrashed, deleteCachedAsset, type CachedAlbum } from '@/lib/cache/albums';
import { reportAuthLost } from '@/lib/session';
import type { CaptureSettings } from '@/lib/settings';
import type { components } from '@/lib/api.gen';

// The mobile Find loop reads the library through the device-authenticated
// endpoints, which speak the same filter language as the web UI.

// Derived from the generated contract rather than hand-declared, so a server-side
// rename or type change breaks the build here instead of drifting silently.
// `/api/search` returns the full apitypes.Asset; mobile only reads this
// subset, and the offline SQLite mirror only persists these columns, so the view
// stays narrow via Pick instead of adopting all ~30 fields.
type ContractAsset = components['schemas']['apitypes.Asset'];

export type LibraryAsset = Pick<
  ContractAsset,
  | 'id'
  | 'filename'
  | 'media_type'
  | 'taken_at'
  | 'taken_day'
  | 'favorite'
  | 'web_viewable'
  | 'thumbnail_url'
  | 'preview_url'
  | 'place_city'
  | 'place_country'
> & {
  // Optional on purpose. The contract always sends it, but synthetic assets
  // built inside the app -- album cover stubs, place points -- carry only the
  // fields their surface needs, and the grid's size badge simply hides when it
  // is absent rather than forcing every construction site to invent a number.
  size_bytes?: number;
};

// Place grouping from /api/places/summary, derived from the contract.
export type PlaceGroup = components['schemas']['apitypes.PlaceGroup'];

// Tag from /api/tags, derived from the contract.
export type Tag = components['schemas']['apitypes.Tag'];

type AuthedSource = { uri: string; headers: Record<string, string> };

export type LibraryPage = { assets: LibraryAsset[]; next_cursor?: string };

export type LibraryFilters = {
  q?: string;
  type?: 'image' | 'video';
  favorite?: boolean;
  from?: string;
  to?: string;
  place_city?: string;
  place_country?: string;
  tag?: string;
  /** The Archived view. `parseAssetFilters` reads `archived=1`; anything else
   *  means the ordinary library, which already excludes archived rows. */
  archived?: boolean;
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
export function isUnfiltered(filters: LibraryFilters): boolean {
  return (
    !filters.q &&
    !filters.type &&
    !filters.favorite &&
    !filters.from &&
    !filters.to &&
    !filters.place_city &&
    !filters.place_country &&
    !filters.tag &&
    // Archived is a filter like any other. Leaving it out here would let the
    // archived page write itself into the offline mirror of the plain
    // timeline, so the next cold start would open on archived photos.
    !filters.archived
  );
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
  if (filters.place_country) params.set('place_country', filters.place_country);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.archived) params.set('archived', '1');
  if (cursor) params.set('cursor', cursor);

  const response = await fetch(`${settings.baseURL}/api/search?${params.toString()}`, {
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
  const response = await fetch(`${settings.baseURL}/api/assets/${id}/favorite`, {
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

// ---- Albums, memories, trash --------------------------------------------
//
// Same Bearer/401/error shape as fetchLibrary/setFavorite above, factored
// into two small helpers: authedGet (GET + JSON parse) and authedMutate
// (POST/DELETE with no meaningful response body). withMirrorFallback wraps a
// read so a real network failure (fetch itself throwing) falls back to the
// SQLite mirror, while an explicit server error — including 401, already
// reported via reportAuthLost inside authedGet — still propagates instead of
// silently serving stale data.

type ServerAlbum = { id: string; name: string; asset_count: number; cover_asset_id?: string };

function toCachedAlbum(a: ServerAlbum): CachedAlbum {
  return { id: a.id, name: a.name, cover_asset_id: a.cover_asset_id ?? null, count: a.asset_count };
}

async function authedGet<T>(settings: CaptureSettings, path: string): Promise<T> {
  const response = await fetch(`${settings.baseURL}${path}`, {
    headers: { Authorization: `Bearer ${settings.deviceToken}` },
  });
  if (response.status === 401) {
    reportAuthLost();
    throw new LibraryError('This device was disconnected. Re-pair it in Settings.', 401);
  }
  if (!response.ok) {
    throw new LibraryError(`Request failed (${response.status})`, response.status);
  }
  return (await response.json()) as T;
}

async function authedMutate(settings: CaptureSettings, path: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(`${settings.baseURL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${settings.deviceToken}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) {
    reportAuthLost();
    throw new LibraryError('This device was disconnected. Re-pair it in Settings.', 401);
  }
  if (!response.ok) {
    throw new LibraryError(`Request failed (${response.status})`, response.status);
  }
}

async function withMirrorFallback<T>(load: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof LibraryError) throw err;
    return fallback();
  }
}

export async function fetchAlbums(settings: CaptureSettings): Promise<CachedAlbum[]> {
  return withMirrorFallback(async () => {
    const body = await authedGet<{ albums: ServerAlbum[] }>(settings, '/api/albums');
    const albums = body.albums.map(toCachedAlbum);
    await upsertAlbums(albums);
    return albums;
  }, readAlbums);
}

/**
 * fetchAlbum returns one page of an album, and the cursor for the next.
 *
 * It used to return a bare array and throw the `next_cursor` away, so an album
 * larger than one page was silently truncated with nothing to page with. The
 * offline mirror is only written for the first page: it is a cache of what the
 * album opens to, and appending later pages into it would leave a partial album
 * looking complete the next time the device is offline.
 */
export async function fetchAlbum(
  settings: CaptureSettings,
  id: string,
  cursor?: string,
): Promise<LibraryPage> {
  return withMirrorFallback(
    async () => {
      const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const page = await authedGet<LibraryPage>(settings, `/api/albums/${id}${params}`);
      if (!cursor) await setAlbumAssets(id, page.assets);
      return page;
    },
    async () => ({ assets: await readAlbumAssets(id) }),
  );
}

/** createAlbum is online-only: a network failure throws so the UI can show
 * "Connect to create an album" rather than silently queuing it. */
export async function createAlbum(settings: CaptureSettings, name: string): Promise<{ id: string; name: string }> {
  const response = await fetch(`${settings.baseURL}/api/albums`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (response.status === 401) {
    reportAuthLost();
    throw new LibraryError('This device was disconnected. Re-pair it in Settings.', 401);
  }
  if (!response.ok) {
    throw new LibraryError(`Could not create album (${response.status})`, response.status);
  }
  return (await response.json()) as { id: string; name: string };
}

/**
 * setArchived moves a selection in or out of the archive and reports how many
 * rows the server actually changed.
 *
 * Both directions, deliberately: archiving hides photos from the timeline, so
 * shipping it without `unarchive` would make the action a one-way door. The
 * endpoint has carried `archive`/`unarchive` since the organization migration;
 * it simply had no mobile caller.
 *
 * The response's `succeeded` is the truth rather than `ids.length`, because the
 * endpoint skips rows the owner does not own instead of failing the request.
 */
export async function setArchived(
  settings: CaptureSettings,
  ids: string[],
  archived: boolean,
): Promise<number> {
  const res = await authedPost<{ succeeded?: number }>(settings, '/api/assets/batch', {
    ids,
    op: archived ? 'archive' : 'unarchive',
  });
  return res.succeeded ?? 0;
}

/**
 * addToAlbum links assets into an album and reports how many were *newly*
 * linked.
 *
 * The server's insert is `INSERT OR IGNORE`, so re-adding something already in
 * the album is harmless and simply does not count — which is why the caller
 * wants the server's number rather than `ids.length`. A count of zero is a
 * successful request that changed nothing.
 */
export async function addToAlbum(
  settings: CaptureSettings,
  albumId: string,
  ids: string[],
): Promise<number> {
  const res = await authedPost<{ added?: number }>(
    settings,
    `/api/albums/${albumId}/assets`,
    { ids },
  );
  return res.added ?? 0;
}

/** removeFromAlbum unlinks assets and reports how many rows actually went. */
export async function removeFromAlbum(
  settings: CaptureSettings,
  albumId: string,
  ids: string[],
): Promise<void> {
  return authedMutate(settings, `/api/albums/${albumId}/assets`, 'DELETE', { ids });
}

// ---- Tags ----------------------------------------------------------------

async function authedPost<T>(settings: CaptureSettings, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${settings.baseURL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    reportAuthLost();
    throw new LibraryError('This device was disconnected. Re-pair it in Settings.', 401);
  }
  if (!response.ok) throw new LibraryError(`Request failed (${response.status})`, response.status);
  return (await response.json()) as T;
}

// fetchTags returns the owner's tag list, cached so browse-by-tag renders
// offline (the grid itself still needs the network, like Places).
export async function fetchTags(settings: CaptureSettings): Promise<Tag[]> {
  const { upsertTags, readTags } = await import('@/lib/cache/tags');
  return withMirrorFallback(async () => {
    const body = await authedGet<{ tags: Tag[] }>(settings, '/api/tags');
    await upsertTags(body.tags);
    return body.tags;
  }, readTags);
}

export async function fetchAssetTags(settings: CaptureSettings, assetId: string): Promise<Tag[]> {
  const body = await authedGet<{ tags: Tag[] }>(settings, `/api/assets/${assetId}/tags`);
  return body.tags;
}

/** setAssetTags replaces an asset's full tag set (the server has no add/remove). */
export async function setAssetTags(settings: CaptureSettings, assetId: string, tagIDs: string[]): Promise<void> {
  await authedMutate(settings, `/api/assets/${assetId}/tags`, 'PUT', { ids: tagIDs });
}

// createTag is online-only: a queued create can't be referenced by a later
// offline set_tags (no stable id yet), so it throws rather than queuing.
export async function createTag(settings: CaptureSettings, name: string): Promise<Tag> {
  return authedPost<Tag>(settings, '/api/tags', { name });
}

export async function fetchMemories(settings: CaptureSettings, cursor?: string): Promise<LibraryPage> {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const page = await authedGet<LibraryPage>(settings, `/api/memories${params}`);
  void upsertAssets(page.assets);
  return page;
}

// fetchPlaces returns every located asset (has GPS) for plotting on the map.
// The server DTO carries gps_lat/gps_lon; the narrow LibraryAsset view omits
// them, so read them off the raw row and attach to the PlacePoint.
export async function fetchPlaces(settings: CaptureSettings): Promise<import('@/lib/places').PlacePoint[]> {
  const body = await authedGet<{ assets: (LibraryAsset & { gps_lat: number | null; gps_lon: number | null })[] }>(
    settings,
    '/api/places',
  );
  return body.assets
    .filter((a): a is LibraryAsset & { gps_lat: number; gps_lon: number } => a.gps_lat != null && a.gps_lon != null)
    .map((a) => ({
      id: a.id,
      filename: a.filename,
      media_type: a.media_type,
      taken_at: a.taken_at,
      taken_day: a.taken_day,
      favorite: a.favorite,
      web_viewable: a.web_viewable,
      thumbnail_url: a.thumbnail_url,
      preview_url: a.preview_url,
      place_city: a.place_city,
      place_country: a.place_country,
      gps_lat: a.gps_lat,
      gps_lon: a.gps_lon,
    }));
}

// fetchPlacesSummary returns place groups (city/country/count/cover) for the
// bottom-sheet list.
export async function fetchPlacesSummary(settings: CaptureSettings): Promise<PlaceGroup[]> {
  const body = await authedGet<{ places: PlaceGroup[] }>(settings, '/api/places/summary');
  return body.places;
}

// Library totals from the server, including the on-disk size. /api/stats sits
// in the router's both-principals group and resolves its owner through
// ownerID(r), so a device token reads its own owner's numbers with no
// device-specific endpoint -- see internal/httpapi/stats_device_test.go.
export type LibraryStats = components['schemas']['apitypes.LibraryStats'];

export async function fetchStats(settings: CaptureSettings): Promise<LibraryStats> {
  return authedGet<LibraryStats>(settings, '/api/stats');
}

// DupAsset is one member of a duplicate group. /api/duplicates returns an
// untyped map on the server (no generated contract type), so this is
// hand-declared to match the DupAsset wire struct.
export type DupAsset = {
  id: string;
  filename: string;
  size_bytes: number;
  taken_at?: string;
  thumbnail_url?: string;
};

// fetchDuplicates returns the latest scan's near-duplicate groups. Read-only on
// mobile: triggering a scan is a session-only owner-console action, so an empty
// result means "no scan yet / no duplicates", not a mobile capability gap.
export async function fetchDuplicates(settings: CaptureSettings): Promise<DupAsset[][]> {
  const body = await authedGet<{ groups: DupAsset[][] }>(settings, '/api/duplicates');
  return body.groups ?? [];
}

export async function fetchTrash(settings: CaptureSettings, cursor?: string): Promise<LibraryPage> {
  return withMirrorFallback(
    async () => {
      const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const page = await authedGet<LibraryPage>(settings, `/api/trash${params}`);
      await upsertAssets(page.assets);
      for (const a of page.assets) await setTrashed(a.id, true);
      return page;
    },
    async () => ({ assets: await readTrashed() }),
  );
}

// ---- Delta sync ----------------------------------------------------------
//
// The server keeps an owner-scoped change_log and serves it as a thin,
// cursor-paginated feed at GET /api/changes (id/entity/op only). This
// reconciles the SQLite mirror against that feed so the phone picks up edits
// made elsewhere (e.g. from the web UI) without a blind full-library refetch.

type ChangeEntry = components['schemas']['apitypes.ChangeEntry'];
type ChangesResponse = components['schemas']['apitypes.ChangesResponse'];

/** fetchAsset re-reads one asset's metadata; null if it is gone (404). */
async function fetchAsset(settings: CaptureSettings, id: string): Promise<LibraryAsset | null> {
  const response = await fetch(`${settings.baseURL}/api/assets/${id}`, {
    headers: { Authorization: `Bearer ${settings.deviceToken}` },
  });
  if (response.status === 401) {
    reportAuthLost();
    throw new LibraryError('This device was disconnected. Re-pair it in Settings.', 401);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new LibraryError(`Request failed (${response.status})`, response.status);
  return (await response.json()) as LibraryAsset;
}

// changeAction is the pure decision for one feed entry, split out so it can be
// unit-tested without the SQLite mirror (same seam pattern as routeForMutation):
//   'ignore'  — not an asset change (no other entity is emitted today)
//   'remove'  — delete/purge; drop from the active timeline mirror
//   'refetch' — create/update; re-read metadata and upsert
export function changeAction(c: ChangeEntry): 'ignore' | 'remove' | 'refetch' {
  if (c.entity !== 'asset') return 'ignore';
  return c.op === 'delete' ? 'remove' : 'refetch';
}

async function applyChange(settings: CaptureSettings, c: ChangeEntry): Promise<void> {
  switch (changeAction(c)) {
    case 'ignore':
      return;
    case 'remove':
      // Trashed or purged — either way it leaves the active timeline mirror. The
      // Trash screen refetches /api/trash live, so we don't try to
      // reconstruct trashed state here (getAsset can't return a deleted asset).
      await deleteCachedAsset(c.entity_id);
      return;
    case 'refetch': {
      // Re-read and upsert. A 404 means it was deleted between the feed page and
      // this refetch — treat it the same as a delete.
      const asset = await fetchAsset(settings, c.entity_id);
      if (asset) await upsertAssets([asset]);
      else await deleteCachedAsset(c.entity_id);
      return;
    }
  }
}

/**
 * syncChanges drains the delta feed and applies each change to the mirror,
 * advancing the persisted cursor as it goes. Returns `applied` (how many changes
 * were applied) and `reset` (whether the server forced a full resync); the
 * caller reloads when either indicates the view may have moved. Best-effort: a
 * network failure leaves the cursor where it was so the next run resumes. A 401
 * propagates (device disconnected) rather than being swallowed.
 */
export async function syncChanges(settings: CaptureSettings): Promise<{ applied: number; reset: boolean }> {
  if (!settings.baseURL || !settings.deviceToken) return { applied: 0, reset: false };
  let applied = 0;
  // Bound the catch-up so a huge backlog can't block one call indefinitely;
  // the next run picks up where the cursor left off.
  for (let page = 0; page < 20; page++) {
    const since = await getSyncCursor();
    const res = await authedGet<ChangesResponse>(
      settings, `/api/changes?since=${since}`);
    // reset: our cursor fell below the pruned change_log floor. We can't catch
    // up incrementally, so wipe the mirror and jump to the head, then signal a
    // reset so the caller reloads and rebuilds the mirror from fetchLibrary.
    if (res.reset) {
      const { clearCachedAssets } = await import('@/lib/cache/assets');
      await clearCachedAssets();
      await setSyncCursor(res.cursor);
      return { applied, reset: true };
    }
    for (const c of res.changes) {
      await applyChange(settings, c);
      applied++;
    }
    // Advance only after the page's changes are applied, so a crash mid-page
    // re-fetches that page rather than skipping unapplied changes.
    await setSyncCursor(res.cursor);
    if (!res.has_more) break;
  }
  return { applied, reset: false };
}

export async function restoreAsset(settings: CaptureSettings, id: string): Promise<void> {
  return authedMutate(settings, `/api/assets/${id}/restore`, 'POST');
}

export async function trashAsset(settings: CaptureSettings, id: string): Promise<void> {
  return authedMutate(settings, `/api/assets/${id}`, 'DELETE');
}

export async function purgeAsset(settings: CaptureSettings, id: string): Promise<void> {
  return authedMutate(settings, `/api/trash/${id}`, 'DELETE');
}

export type MutationKind = 'favorite' | 'album_add' | 'album_remove' | 'trash' | 'restore' | 'purge' | 'set_tags';

// routeForMutation maps a queued mutation to its server call. Pure so the
// dispatch table is unit-tested without a network or SecureStore.
export function routeForMutation(
  kind: string,
  assetId: string,
  payload: string,
): { method: string; path: string; body?: unknown } {
  const p = JSON.parse(payload || '{}') as { favorite?: boolean; album_id?: string; tag_ids?: string[] };
  switch (kind) {
    case 'favorite':
      return { method: 'POST', path: `/api/assets/${assetId}/favorite`, body: { favorite: !!p.favorite } };
    case 'set_tags':
      return { method: 'PUT', path: `/api/assets/${assetId}/tags`, body: { ids: p.tag_ids ?? [] } };
    case 'album_add':
      return { method: 'POST', path: `/api/albums/${p.album_id}/assets`, body: { ids: [assetId] } };
    case 'album_remove':
      return { method: 'DELETE', path: `/api/albums/${p.album_id}/assets`, body: { ids: [assetId] } };
    case 'trash':
      return { method: 'DELETE', path: `/api/assets/${assetId}`, body: undefined };
    case 'restore':
      return { method: 'POST', path: `/api/assets/${assetId}/restore`, body: undefined };
    case 'purge':
      return { method: 'DELETE', path: `/api/trash/${assetId}`, body: undefined };
    default:
      throw new LibraryError(`unknown mutation kind: ${kind}`);
  }
}

// flushMutationsQueue drains the offline mutation queue (favorites, album
// add/remove, trash, restore, purge) over a reconnected link. Each queued write
// maps to the {status, networkError} shape flushMutations expects: a clean send
// is the response status, a 401 (device re-revoked mid-flush) is reported
// explicitly, anything thrown by fetch itself is a network error worth retrying
// later. Shared by Settings (on Save) and Library (on recovery) so the send
// shape lives in exactly one place.
//
// Dispatch (routeForMutation/JSON.parse) is kept out of the fetch try/catch:
// an undispatchable mutation (corrupt payload, unknown kind) is not a network
// problem, so it must not be classified as one — that would retry forever
// instead of being dropped.
export async function flushMutationsQueue(settings: CaptureSettings): Promise<void> {
  const send = async (m: PendingMutation) => {
    let call: { method: string; path: string; body?: unknown };
    try {
      call = routeForMutation(m.kind, m.asset_id, m.payload);
    } catch {
      return { status: 422, networkError: false }; // undispatchable -> drop
    }
    try {
      const response = await fetch(`${settings.baseURL}${call.path}`, {
        method: call.method,
        headers: {
          Authorization: `Bearer ${settings.deviceToken}`,
          ...(call.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
      });
      if (response.status === 401) {
        reportAuthLost();
        return { status: 401, networkError: false };
      }
      return { status: response.status, networkError: false };
    } catch {
      return { status: 0, networkError: true }; // network -> retry
    }
  };
  await flushMutations(send);
}

// Spec 1 call sites (Settings on Save, Library on recovery) keep calling this
// name unchanged; flushMutationsQueue now handles every mutation kind.
export const flushFavorites = flushMutationsQueue;

function authed(settings: CaptureSettings, id: string, kind: 'thumb' | 'preview' | 'original'): AuthedSource {
  return {
    uri: `${settings.baseURL}/api/assets/${id}/${kind}`,
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
