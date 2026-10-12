import { orderedLibraryWork } from '@/lib/cache/operations';
import {
  flushMutations,
  enqueueMutation,
  intentRejection,
  type PendingMutation,
} from '@/lib/cache/mutations';
import { upsertAssets, getSyncCursor, setSyncCursor } from '@/lib/cache/assets';
import {
  upsertAlbums,
  readAlbums,
  setAlbumAssets,
  readAlbumAssets,
  setTrashed,
  readTrashed,
  deleteCachedAsset,
  type CachedAlbum,
} from '@/lib/cache/albums';
import { reportAuthLost } from '@/lib/session';
import {
  assertActiveConnection,
  StaleConnectionError,
  withActiveConnection,
  type CaptureSettings,
} from '@/lib/settings';
import { jsonRequest, request, RequestError } from '@/lib/request';
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
  | 'thumbnail_urls'
  | 'preview_url'
  | 'place_city'
  | 'place_country'
> & {
  // Optional on purpose. The contract always sends it, but synthetic assets
  // built inside the app -- album cover stubs, place points -- carry only the
  // fields their surface needs, and the grid's size badge simply hides when it
  // is absent rather than forcing every construction site to invent a number.
  size_bytes?: number;
  /**
   * Video length, for the duration badge over a video tile.
   *
   * Optional for the same reason as `size_bytes`: the contract always sends it,
   * but synthetic assets assembled inside the app carry only the fields their
   * surface needs. `formatDuration` returns null for a missing or zero value,
   * so the badge simply does not draw.
   */
  duration_ms?: number;
  /**
   * How many originals this tile stands for, for the stack badge.
   *
   * A plain asset reports 1 (or nothing, when synthesised); only a value above
   * 1 marks the tile as the visible face of a stack.
   */
  stack_size?: number;
};

// Place grouping from /api/places/summary, derived from the contract.
export type PlaceGroup = components['schemas']['apitypes.PlaceGroup'];

// Tag from /api/tags, derived from the contract.
export type Tag = components['schemas']['apitypes.Tag'];
export type Trip = components['schemas']['apitypes.Trip'];

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
  /** A detected trip. Membership is the overlay of detection and the user's own
   *  additions and removals; the server applies that, not the client. */
  trip?: string;
  /** The Archived view. `parseAssetFilters` reads `archived=1`; anything else
   *  means the ordinary library, which already excludes archived rows. */
  archived?: boolean;
};

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
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
    !filters.trip &&
    // Archived is a filter like any other. Leaving it out here would let the
    // archived page write itself into the offline mirror of the plain
    // timeline, so the next cold start would open on archived photos.
    !filters.archived
  );
}

/**
 * mirror runs an offline-cache write that the caller does not wait for.
 *
 * The `.catch` is the point. These used to be bare `void upsertAssets(...)`,
 * and a failing SQLite write — a locked database after an abrupt termination,
 * say — became an *unhandled rejection*, which expo surfaces as a red error
 * banner over the UI. A cache that cannot write is not a failure the user needs
 * to see: the request it came from already succeeded, and the next open simply
 * refetches. Swallowed rather than logged to match how the rest of the app
 * treats best-effort work (see the tag fetch in photo-viewer).
 */
function mirror(
  settings: CaptureSettings,
  write: () => Promise<unknown>,
): void {
  void withActiveConnection(settings, write).catch(() => {});
}
async function libraryJSON<T>(
  settings: CaptureSettings,
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await jsonRequest<T>(settings, path, init, signal);
  } catch (error) {
    if (error instanceof RequestError && error.status > 0)
      throw new LibraryError(error.message, error.status);
    throw error;
  }
}

export async function fetchLibrary(
  settings: CaptureSettings,
  filters: LibraryFilters,
  cursor?: string,
  signal?: AbortSignal,
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

  if (filters.trip) params.set('trip', filters.trip);
  const page = await libraryJSON<LibraryPage>(
    settings,
    `/api/search?${params.toString()}`,
    {},
    signal,
  );
  if (isUnfiltered(filters)) mirror(settings, () => upsertAssets(page.assets, settings));
  return page;
}

/** setFavorite pushes a favorite toggle to the server for one asset. */
export async function setFavorite(
  settings: CaptureSettings,
  id: string,
  favorite: boolean,
): Promise<void> {
  return queueIntent(settings, [id], 'favorite', { favorite });
}

// ---- Albums, memories, trash --------------------------------------------
//
// Same Bearer/401/error shape as fetchLibrary/setFavorite above, factored
// into authedGet (GET + JSON parse) and the durable mutation queue.
// withMirrorFallback wraps a
// read so a real network failure (fetch itself throwing) falls back to the
// SQLite mirror, while an explicit server error — including 401, already
// reported via reportAuthLost inside authedGet — still propagates instead of
// silently serving stale data.

// Derived from the contract rather than hand-declared. The hand-written version
// claimed a `cover_asset_id` the server never sent — apitypes.Album had no cover
// field at all — so every album in the list drew a blank square and nothing in
// the type system objected.
type ServerAlbum = components['schemas']['apitypes.Album'];

function toCachedAlbum(a: ServerAlbum): CachedAlbum {
  return {
    id: a.id,
    name: a.name,
    // Kept for the cached rows that still carry it; the mosaic reads the list.
    cover_asset_id: a.cover_asset_ids?.[0] ?? null,
    cover_asset_ids: a.cover_asset_ids ?? [],
    count: a.asset_count,
  };
}

async function authedGet<T>(
  settings: CaptureSettings,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  return libraryJSON<T>(settings, path, {}, signal);
}
async function withMirrorFallback<T>(
  load: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof LibraryError || err instanceof StaleConnectionError)
      throw err;
    return fallback();
  }
}

export async function fetchAlbums(
  settings: CaptureSettings,
): Promise<CachedAlbum[]> {
  return withMirrorFallback(
    async () => {
      const body = await authedGet<{ albums: ServerAlbum[] }>(
        settings,
        '/api/albums',
      );
      const albums = body.albums.map(toCachedAlbum);
      await withActiveConnection(settings, () => upsertAlbums(albums, settings));
      return albums;
    },
    () => withActiveConnection(settings, () => readAlbums(settings)),
  );
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
  signal?: AbortSignal,
): Promise<LibraryPage> {
  return withMirrorFallback(
    async () => {
      const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const page = await authedGet<LibraryPage>(
        settings,
        `/api/albums/${id}${params}`,
      );
      if (!cursor)
        await withActiveConnection(settings, () =>
          setAlbumAssets(id, page.assets, settings),
        );
      return page;
    },
    async () => ({
      assets: await withActiveConnection(settings, () => readAlbumAssets(id, settings)),
    }),
  );
}

/** createAlbum is online-only: a network failure throws so the UI can show
 * "Connect to create an album" rather than silently queuing it. */
export async function createAlbum(
  settings: CaptureSettings,
  name: string,
): Promise<{ id: string; name: string }> {
  return libraryJSON(settings, '/api/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
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
  const res = await authedPost<{ succeeded?: number }>(
    settings,
    '/api/assets/batch',
    {
      ids,
      op: archived ? 'archive' : 'unarchive',
    },
  );
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
): Promise<void> {
  return queueIntent(settings, ids, 'album_add', { album_id: albumId });
}

/** removeFromAlbum unlinks assets and reports how many rows actually went. */
export async function removeFromAlbum(
  settings: CaptureSettings,
  albumId: string,
  ids: string[],
): Promise<void> {
  return queueIntent(settings, ids, 'album_remove', { album_id: albumId });
}

// ---- Tags ----------------------------------------------------------------

async function authedPost<T>(
  settings: CaptureSettings,
  path: string,
  body: unknown,
): Promise<T> {
  return libraryJSON(settings, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// fetchTags returns the owner's tag list, cached so browse-by-tag renders
// offline (the grid itself still needs the network, like Places).
/**
 * fetchTrips reads the detected trips.
 *
 * No offline mirror, unlike tags: a trip is recomputed server-side after every
 * import, so a cached copy goes stale in a way a tag list does not. The screen
 * shows its connection state instead of a stale list.
 */
export async function fetchTrips(settings: CaptureSettings): Promise<Trip[]> {
  const body = await authedGet<{ trips: Trip[] }>(settings, '/api/trips');
  return body.trips;
}

export async function fetchTags(settings: CaptureSettings): Promise<Tag[]> {
  const { upsertTags, readTags } = await import('@/lib/cache/tags');
  return withMirrorFallback(
    async () => {
      const body = await authedGet<{ tags: Tag[] }>(settings, '/api/tags');
      await withActiveConnection(settings, () => upsertTags(body.tags, settings));
      return body.tags;
    },
    () => withActiveConnection(settings, () => readTags(settings)),
  );
}

export async function fetchAssetTags(
  settings: CaptureSettings,
  assetId: string,
): Promise<Tag[]> {
  const body = await authedGet<{ tags: Tag[] }>(
    settings,
    `/api/assets/${assetId}/tags`,
  );
  return body.tags;
}

/** setAssetTags replaces an asset's full tag set (the server has no add/remove). */
export async function setAssetTags(
  settings: CaptureSettings,
  assetId: string,
  tagIDs: string[],
): Promise<void> {
  return queueIntent(settings, [assetId], 'set_tags', { tag_ids: tagIDs });
}

// createTag is online-only: a queued create can't be referenced by a later
// offline set_tags (no stable id yet), so it throws rather than queuing.
export async function createTag(
  settings: CaptureSettings,
  name: string,
): Promise<Tag> {
  return authedPost<Tag>(settings, '/api/tags', { name });
}

export async function fetchMemories(
  settings: CaptureSettings,
  cursor?: string,
  signal?: AbortSignal,
): Promise<LibraryPage> {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const page = await authedGet<LibraryPage>(settings, `/api/memories${params}`);
  mirror(settings, () => upsertAssets(page.assets, settings));
  return page;
}

// fetchPlaces returns every located asset (has GPS) for plotting on the map.
// The server DTO carries gps_lat/gps_lon; the narrow LibraryAsset view omits
// them, so read them off the raw row and attach to the PlacePoint.
export async function fetchPlaces(
  settings: CaptureSettings,
): Promise<import('@/lib/places').PlacePoint[]> {
  const body = await authedGet<{
    assets: (LibraryAsset & {
      gps_lat: number | null;
      gps_lon: number | null;
    })[];
  }>(settings, '/api/places');
  return body.assets
    .filter(
      (a): a is LibraryAsset & { gps_lat: number; gps_lon: number } =>
        a.gps_lat != null && a.gps_lon != null,
    )
    .map((a) => ({
      id: a.id,
      filename: a.filename,
      media_type: a.media_type,
      taken_at: a.taken_at,
      taken_day: a.taken_day,
      favorite: a.favorite,
      web_viewable: a.web_viewable,
      thumbnail_url: a.thumbnail_url,
      thumbnail_urls: a.thumbnail_urls,
      preview_url: a.preview_url,
      place_city: a.place_city,
      place_country: a.place_country,
      gps_lat: a.gps_lat,
      gps_lon: a.gps_lon,
    }));
}

// fetchPlacesSummary returns place groups (city/country/count/cover) for the
// bottom-sheet list.
export async function fetchPlacesSummary(
  settings: CaptureSettings,
): Promise<PlaceGroup[]> {
  const body = await authedGet<{ places: PlaceGroup[] }>(
    settings,
    '/api/places/summary',
  );
  return body.places;
}

// Library totals from the server, including the on-disk size. /api/stats sits
// in the router's both-principals group and resolves its owner through
// ownerID(r), so a device token reads its own owner's numbers with no
// device-specific endpoint -- see internal/httpapi/stats_device_test.go.
export type LibraryStats = components['schemas']['apitypes.LibraryStats'];

export async function fetchStats(
  settings: CaptureSettings,
): Promise<LibraryStats> {
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
export async function fetchDuplicates(
  settings: CaptureSettings,
): Promise<DupAsset[][]> {
  const body = await authedGet<{ groups: DupAsset[][] }>(
    settings,
    '/api/duplicates',
  );
  return body.groups ?? [];
}

export async function fetchTrash(
  settings: CaptureSettings,
  cursor?: string,
  signal?: AbortSignal,
): Promise<LibraryPage> {
  return withMirrorFallback(
    async () => {
      const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const page = await authedGet<LibraryPage>(
        settings,
        `/api/trash${params}`,
      );
      await withActiveConnection(settings, async () => {
        await upsertAssets(page.assets, settings);
        for (const a of page.assets) await setTrashed(a.id, true, settings);
      });
      return page;
    },
    async () => ({
      assets: await withActiveConnection(settings, () => readTrashed(settings)),
    }),
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

/**
 * AssetDetail is the server's full record for one asset — everything
 * `LibraryAsset` deliberately leaves out (dimensions, camera, MIME, GPS).
 *
 * The grid works from the narrow `LibraryAsset` on purpose: a timeline page
 * carries hundreds of these and the extra fields are dead weight there. The
 * details sheet is the one surface that wants all of it, for exactly one asset
 * at a time, so it fetches it on open rather than widening every list response.
 */
export type AssetDetail = components['schemas']['apitypes.Asset'];

/** fetchAssetDetail reads one asset's full metadata for the details sheet. */
export async function fetchAssetDetail(
  settings: CaptureSettings,
  id: string,
): Promise<AssetDetail> {
  return authedGet<AssetDetail>(settings, `/api/assets/${id}`);
}

/** fetchAsset re-reads one asset's metadata; null if it is gone (404). */
async function fetchAsset(
  settings: CaptureSettings,
  id: string,
  signal?: AbortSignal,
): Promise<LibraryAsset | null> {
  try {
    return await authedGet(settings, `/api/assets/${id}`, signal);
  } catch (error) {
    if (error instanceof LibraryError && error.status === 404) return null;
    throw error;
  }
}

export function changeAction(c: ChangeEntry): 'ignore' | 'remove' | 'refetch' {
  if (c.entity !== 'asset') return 'ignore';
  return c.op === 'delete' ? 'remove' : 'refetch';
}

async function applyChange(
  settings: CaptureSettings,
  c: ChangeEntry,
  signal?: AbortSignal,
): Promise<void> {
  switch (changeAction(c)) {
    case 'ignore':
      return;
    case 'remove':
      // Trashed or purged — either way it leaves the active timeline mirror. The
      // Trash screen refetches /api/trash live, so we don't try to
      // reconstruct trashed state here (getAsset can't return a deleted asset).
      await withActiveConnection(settings, () =>
        deleteCachedAsset(c.entity_id, settings),
      );
      return;
    case 'refetch': {
      // Re-read and upsert. A 404 means it was deleted between the feed page and
      // this refetch — treat it the same as a delete.
      const asset = await fetchAsset(settings, c.entity_id, signal);
      if (asset)
        await withActiveConnection(settings, () => upsertAssets([asset], settings));
      else
        await withActiveConnection(settings, () =>
          deleteCachedAsset(c.entity_id, settings),
        );
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
export async function syncChanges(
  settings: CaptureSettings,
  signal?: AbortSignal,
): Promise<{ applied: number; reset: boolean }> {
  if (!settings.baseURL || !settings.deviceToken)
    return { applied: 0, reset: false };
  const { getDB } = await import('@/lib/cache/db');
  const db = await getDB(settings);
  return orderedLibraryWork(db, () => drainChanges(settings, signal), signal);
}

async function drainChanges(
  settings: CaptureSettings,
  signal?: AbortSignal,
): Promise<{ applied: number; reset: boolean }> {
  if (!settings.baseURL || !settings.deviceToken)
    return { applied: 0, reset: false };
  let applied = 0;
  // Bound the catch-up so a huge backlog can't block one call indefinitely;
  // the next run picks up where the cursor left off.
  for (let page = 0; page < 20; page++) {
    const since = await withActiveConnection(settings, () => getSyncCursor(settings));
    const res = await authedGet<ChangesResponse>(
      settings,
      `/api/changes?since=${since}`,
      signal,
    );
    // reset: our cursor fell below the pruned change_log floor. We can't catch
    // up incrementally, so wipe the mirror and jump to the head, then signal a
    // reset so the caller reloads and rebuilds the mirror from fetchLibrary.
    if (res.reset) {
      const { clearCachedAssets } = await import('@/lib/cache/assets');
      await withActiveConnection(settings, async () => {
        await clearCachedAssets(settings);
        await setSyncCursor(res.cursor, settings);
      });
      return { applied, reset: true };
    }
    for (const c of res.changes) {
      await applyChange(settings, c, signal);
      applied++;
    }
    // Advance only after the page's changes are applied, so a crash mid-page
    // re-fetches that page rather than skipping unapplied changes.
    await withActiveConnection(settings, () => setSyncCursor(res.cursor, settings));
    if (!res.has_more) break;
  }
  return { applied, reset: false };
}

export async function restoreAsset(
  settings: CaptureSettings,
  id: string,
): Promise<void> {
  return queueIntent(settings, [id], 'restore', {});
}

export async function trashAsset(
  settings: CaptureSettings,
  id: string,
): Promise<void> {
  return queueIntent(settings, [id], 'trash', {});
}

export async function purgeAsset(
  settings: CaptureSettings,
  id: string,
): Promise<void> {
  return queueIntent(settings, [id], 'purge', {});
}

export type MutationKind =
  | 'favorite'
  | 'album_add'
  | 'album_remove'
  | 'trash'
  | 'restore'
  | 'purge'
  | 'set_tags';

// routeForMutation maps a queued mutation to its server call. Pure so the
// dispatch table is unit-tested without a network or SecureStore.
export function routeForMutation(
  kind: string,
  assetId: string,
  payload: string,
): { method: string; path: string; body?: unknown } {
  const p = JSON.parse(payload || '{}') as {
    favorite?: boolean;
    album_id?: string;
    tag_ids?: string[];
  };
  switch (kind) {
    case 'favorite':
      return {
        method: 'POST',
        path: `/api/assets/${assetId}/favorite`,
        body: { favorite: !!p.favorite },
      };
    case 'set_tags':
      return {
        method: 'PUT',
        path: `/api/assets/${assetId}/tags`,
        body: { ids: p.tag_ids ?? [] },
      };
    case 'album_add':
      return {
        method: 'POST',
        path: `/api/albums/${p.album_id}/assets`,
        body: { ids: [assetId] },
      };
    case 'album_remove':
      return {
        method: 'DELETE',
        path: `/api/albums/${p.album_id}/assets`,
        body: { ids: [assetId] },
      };
    case 'trash':
      return {
        method: 'DELETE',
        path: `/api/assets/${assetId}`,
        body: undefined,
      };
    case 'restore':
      return {
        method: 'POST',
        path: `/api/assets/${assetId}/restore`,
        body: undefined,
      };
    case 'purge':
      return {
        method: 'DELETE',
        path: `/api/trash/${assetId}`,
        body: undefined,
      };
    default:
      throw new LibraryError(`unknown mutation kind: ${kind}`);
  }
}

// Durable ordering applies to online edits too: an older offline operation must
// never replay after a newer successful edit. Transport failures retain the
// already queued intent, so UI fallback paths do not enqueue it twice.
async function queueIntent(
  settings: CaptureSettings,
  ids: string[],
  kind: MutationKind,
  payload: Record<string, unknown>,
): Promise<void> {
  const queued = await withActiveConnection(settings, async () => {
    const rows: number[] = [];
    for (const id of ids) rows.push(await enqueueMutation(id, kind, payload, settings));
    return rows;
  });
  try {
    await flushMutationsQueue(settings);
  } catch {
    /* the durable intent remains for recovery */
  }
  await assertActiveConnection(settings);
  const rejected = await intentRejection(settings, queued);
  if (rejected)
    throw new LibraryError(editFailureMessage(rejected.message, rejected.status), rejected.status);
}

function editFailureMessage(code: string, status: number): string {
  const messages: Record<string, string> = {
    album_not_found: 'This album no longer exists. Choose another album.',
    asset_not_found: 'This photo is no longer available. Refresh your library.',
    invalid_tag_ids: 'Some selected tags are no longer available. Reopen Tags and choose again.',
    tag_not_found: 'This tag no longer exists. Refresh your tags.',
  };
  return messages[code] ?? (status === 403
    ? 'You do not have permission to make this change.'
    : 'The server could not apply this change. Refresh and try again.');
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
export async function flushMutationsQueue(
  settings: CaptureSettings,
  callerSignal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  callerSignal?.addEventListener('abort', abort, { once: true });
  if (callerSignal?.aborted) abort();
  const deadline = setTimeout(abort, 30000);
  const signal = controller.signal;
  try {
    const send = async (m: PendingMutation) => {
      let call: { method: string; path: string; body?: unknown };
      try {
        call = routeForMutation(m.kind, m.asset_id, m.payload);
      } catch {
        return { status: 422, networkError: false }; // undispatchable -> drop
      }
      try {
        const response = await request(
          settings,
          call.path,
          {
            method: call.method,
            headers: {
              Authorization: `Bearer ${settings.deviceToken}`,
              ...(call.body !== undefined
                ? { 'Content-Type': 'application/json' }
                : {}),
            },
            ...(call.body !== undefined
              ? { body: JSON.stringify(call.body) }
              : {}),
          },
          async (response) => {
            let message: string | undefined;
            if (!response.ok) {
              const body = await response.json().catch(() => ({})) as { error?: unknown };
              if (typeof body.error === 'string') message = body.error;
            }
            return { status: response.status, message };
          },
          signal,
        );
        if (response.status === 401) {
          reportAuthLost(settings);
          return { status: 401, networkError: false };
        }
        return { status: response.status, message: response.message, networkError: false };
      } catch (error) {
        if (signal?.aborted) throw error;
        return { status: 0, networkError: true }; // network -> retry
      }
    };
    await assertActiveConnection(settings);
    await flushMutations(send, settings, signal);
  } finally {
    clearTimeout(deadline);
    callerSignal?.removeEventListener('abort', abort);
  }
}

// Spec 1 call sites (Settings on Save, Library on recovery) keep calling this
// name unchanged; flushMutationsQueue now handles every mutation kind.
export const flushFavorites = flushMutationsQueue;

function authed(
  settings: CaptureSettings,
  id: string,
  kind: 'thumb' | 'preview' | 'original',
): AuthedSource {
  return {
    uri: `${settings.baseURL}/api/assets/${id}/${kind}`,
    headers: { Authorization: `Bearer ${settings.deviceToken}` },
  };
}

export type ThumbTier = 's' | 'm' | 'l';

/** serverSource authenticates a URL path the server issued, keeping its ?v= cache key. */
function serverSource(settings: CaptureSettings, path: string): AuthedSource {
  return {
    uri: `${settings.baseURL}${path}`,
    headers: { Authorization: `Bearer ${settings.deviceToken}` },
  };
}

/**
 * thumbSource builds an authenticated expo-image source for a thumbnail tier, or
 * null when no thumbnail exists. Server-issued URLs carry a version, so
 * expo-image's cache refreshes after a rebuild; synthetic stubs (album covers)
 * carry only an id and use the unversioned route.
 */
export function thumbSource(
  settings: CaptureSettings,
  asset: LibraryAsset,
  tier: ThumbTier = 'm',
): AuthedSource | null {
  if (!asset.thumbnail_url || !settings.baseURL) return null;
  const path = asset.thumbnail_urls?.[tier] ?? asset.thumbnail_url;
  return path.startsWith('/api/')
    ? serverSource(settings, path)
    : authed(settings, asset.id, 'thumb');
}

/**
 * fullImageSource picks the best full-size image the phone can display: a
 * browser-safe preview derivative if one exists, otherwise the original when it
 * is web-viewable, otherwise the thumbnail as a last resort.
 */
export function fullImageSource(
  settings: CaptureSettings,
  asset: LibraryAsset,
): AuthedSource | null {
  if (!settings.baseURL) return null;
  if (asset.preview_url) return serverSource(settings, asset.preview_url);
  if (asset.web_viewable) return authed(settings, asset.id, 'original');
  return thumbSource(settings, asset);
}

/** Use the server-certified playback derivative when the original needs transcoding. */
export function videoSource(
  settings: CaptureSettings,
  asset: LibraryAsset,
): AuthedSource | null {
  if (!settings.baseURL || !asset.web_viewable) return null;
  return asset.preview_url
    ? serverSource(settings, asset.preview_url)
    : authed(settings, asset.id, 'original');
}
