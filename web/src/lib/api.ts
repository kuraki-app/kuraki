import { session } from './stores';
import type { Album, Asset, AssetList, BackupStatus, ChangesResponse, DeviceInfo, DupAsset, DuplicateRun, ExternalLibrary, IntegrityRun, Job, JobDetail, LibraryStats, MediaIssue, PlaceGroup, SavedSearch, SettingsPatchResponse, SettingsResponse, SetupStatus, Tag, UserCreate, UserList, UserPatch, UserSummary } from './types';

export type AssetPatch = {
  taken_at?: string;
  description?: string;
  gps_lat?: number;
  gps_lon?: number;
  clear_gps?: boolean;
  /** 0-5, where 0 is unrated. */
  rating?: number;
};

function jsonBody(obj: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  if (res.status === 401) {
    session.update((s) => ({ ...s, user: null }));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      body && typeof body.error === 'string' ? body.error : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return (await res.json()) as T;
  return undefined as T;
}

export type SearchParams = {
  q?: string;
  from?: string;
  to?: string;
  type?: string;
  camera?: string;
  rating?: string;
  favorite?: string;
  place_city?: string;
  place_country?: string;
  album?: string;
  archived?: string;
  hidden?: string;
  tag?: string;
};

// One page size for every list, and the cursor when there is one. 100 matches
// what /assets and /search already used; the 500s elsewhere were a way of
// avoiding pagination rather than a considered page size.
const PAGE_LIMIT = 100;

function pageParams(cursor: string): string {
  const p = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}

export const api = {
  setupStatus: () => req<SetupStatus>('/api/setup'),
  setup: (username: string, password: string) =>
    req<SetupStatus>('/api/setup', jsonBody({ username, password })),
  login: (username: string, password: string) =>
    req<SetupStatus>('/api/login', jsonBody({ username, password })),
  logout: () => req<void>('/api/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<void>('/api/account/password', jsonBody({ current_password: currentPassword, new_password: newPassword })),

  // Admin-only (403 admin_required otherwise). Account administration --
  // these never expose another user's library contents.
  users: () => req<UserList>('/api/users'),
  createUser: (body: UserCreate) => req<UserSummary>('/api/users', jsonBody(body)),
  patchUser: (id: string, patch: UserPatch) =>
    req<UserSummary>(`/api/users/${id}`, jsonBody(patch, 'PATCH')),
  deleteUser: (id: string, purge = false) =>
    req<void>(`/api/users/${id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' }),

  assets: (cursor = '') =>
    req<AssetList>(`/api/assets?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  search: (params: SearchParams, cursor?: string) => {
    const p = new URLSearchParams({ limit: '100' });
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    if (cursor) p.set('cursor', cursor);
    return req<AssetList>(`/api/search?${p.toString()}`);
  },
  // These all page. They used to ask for `limit=500` and ignore the
  // `next_cursor` that came back, so a library past 500 items simply stopped —
  // silently, with no "load more" and nothing to say the list was partial.
  favorites: (cursor = '') => req<AssetList>(`/api/favorites?${pageParams(cursor)}`),
  memories: (cursor = '', date = '') =>
    req<AssetList>(`/api/memories?${pageParams(cursor)}${date ? `&date=${date}` : ''}`),
  trash: (cursor = '') => req<AssetList>(`/api/trash?${pageParams(cursor)}`),
  archived: (cursor = '') => req<AssetList>(`/api/assets?archived=1&${pageParams(cursor)}`),
  hidden: (cursor = '') => req<AssetList>(`/api/assets?hidden=1&${pageParams(cursor)}`),

  setFavorite: (id: string, favorite: boolean) =>
    req<void>(`/api/assets/${id}/favorite`, jsonBody({ favorite })),
  patchAsset: (id: string, patch: AssetPatch) => req<Asset>(`/api/assets/${id}`, jsonBody(patch, 'PATCH')),
  shiftTime: (ids: string[], minutes: number) =>
    req<{ updated: number }>('/api/assets/shift-time', jsonBody({ ids, minutes })),
  remove: (id: string) => req<void>(`/api/assets/${id}`, { method: 'DELETE' }),
  restore: (id: string) => req<void>(`/api/assets/${id}/restore`, { method: 'POST' }),
  /** Permanently deletes one trashed asset — the original leaves the disk. */
  purge: (id: string) => req<void>(`/api/trash/${id}`, { method: 'DELETE' }),
  batch: (
    op:
      | 'delete'
      | 'restore'
      // Permanent and irreversible; every other op here can be undone.
      | 'purge'
      | 'favorite'
      | 'unfavorite'
      | 'archive'
      | 'unarchive'
      | 'hide'
      | 'unhide',
    ids: string[]
  ) => req<{ succeeded: number }>('/api/assets/batch', jsonBody({ op, ids })),

  albums: () => req<{ albums: Album[] }>('/api/albums'),
  album: (id: string, cursor = '') => req<AssetList>(`/api/albums/${id}?${pageParams(cursor)}`),
  stack: (id: string) => req<AssetList>(`/api/assets/${id}/stack`),
  createAlbum: (name: string) => req<Album>('/api/albums', jsonBody({ name })),
  renameAlbum: (id: string, name: string) =>
    req<Album>(`/api/albums/${id}`, jsonBody({ name }, 'PATCH')),
  deleteAlbum: (id: string) => req<void>(`/api/albums/${id}`, { method: 'DELETE' }),
  addToAlbum: (id: string, ids: string[]) =>
    req<{ added: number }>(`/api/albums/${id}/assets`, jsonBody({ ids })),
  removeFromAlbum: (id: string, ids: string[]) =>
    req<{ removed: number }>(`/api/albums/${id}/assets`, jsonBody({ ids }, 'DELETE')),

  places: () => req<AssetList>('/api/places'),
  placesSummary: () => req<{ places: PlaceGroup[] }>('/api/places/summary'),
  stats: () => req<LibraryStats>('/api/stats'),
  jobs: () => req<{ jobs: Job[] }>('/api/jobs'),
  job: (id: string) => req<JobDetail>(`/api/jobs/${id}`),
  mediaIssues: () => req<{ issues: MediaIssue[] }>('/api/media/issues'),
  rebuildAsset: (id: string) => req<{ status: string }>(`/api/assets/${id}/rebuild`, { method: 'POST' }),
  // The endpoint has always returned `run` alongside the groups; the client
  // typed it away, so an empty Duplicates page could not tell "never scanned"
  // from "scan running" from "no duplicates found".
  duplicates: () => req<{ groups: DupAsset[][]; run: DuplicateRun | null }>('/api/duplicates'),
  integrity: () => req<{ last: IntegrityRun | null }>('/api/integrity'),
  runIntegrity: () => req<{ status: string }>('/api/integrity/run', { method: 'POST' }),
  backup: () => req<BackupStatus>('/api/backup'),
  createPairingCode: () =>
    req<{ code: string; expires_at: string }>('/api/devices/pair', { method: 'POST' }),
  tags: () => req<{ tags: Tag[] }>('/api/tags'),
  createTag: (name: string, parent_id?: string) => req<Tag>('/api/tags', jsonBody({ name, parent_id })),
  deleteTag: (id: string) => req<void>(`/api/tags/${id}`, { method: 'DELETE' }),
  assetTags: (id: string) => req<{ tags: Tag[] }>(`/api/assets/${id}/tags`),
  setAssetTags: (id: string, ids: string[]) => req<{ tags: Tag[] }>(`/api/assets/${id}/tags`, jsonBody({ ids }, 'PUT')),
  changes: (since: number, limit?: number) =>
    req<ChangesResponse>(`/api/changes?since=${since}${limit ? `&limit=${limit}` : ''}`),
  savedSearches: () => req<{ saved_searches: SavedSearch[] }>('/api/saved-searches'),
  createSavedSearch: (name: string, query: Record<string, string>) => req<SavedSearch>('/api/saved-searches', jsonBody({ name, query })),
  deleteSavedSearch: (id: string) => req<void>(`/api/saved-searches/${id}`, { method: 'DELETE' }),

  settings: () => req<SettingsResponse>('/api/settings'),
  patchSettings: (patch: Record<string, string>) =>
    req<SettingsPatchResponse>('/api/settings', jsonBody(patch, 'PATCH')),
  devices: () => req<{ devices: DeviceInfo[] }>('/api/devices'),
  revokeDevice: (id: string) => req<void>(`/api/devices/${id}`, { method: 'DELETE' }),
  externalLibraries: () => req<{ libraries: ExternalLibrary[] }>('/api/external-libraries'),
  createExternalLibrary: (name: string, rootPath: string) =>
    req<{ id: string; name: string; root_path: string; scanned: number; indexed: number }>(
      '/api/external-libraries',
      jsonBody({ name, root_path: rootPath })
    ),
  scanExternalLibrary: (id: string) =>
    req<{ scanned: number; indexed: number }>(`/api/external-libraries/${id}/scan`, { method: 'POST' }),
  // Forgets the library and its indexed rows. Never touches the files: Kuraki
  // does not own them and never copied them.
  deleteExternalLibrary: (id: string) =>
    req<{ removed: number }>(`/api/external-libraries/${id}`, { method: 'DELETE' }),
  runDuplicatesScan: () => req<void>('/api/duplicates/run', { method: 'POST' })
};

// downloadZip streams a zip of the given originals to a browser download.
export async function downloadZip(ids: string[]): Promise<void> {
  const res = await fetch('/api/assets/zip', {
    credentials: 'same-origin',
    ...jsonBody({ ids })
  });
  if (!res.ok) throw new Error('download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kuraki-export.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// uploadFiles posts files as multipart, reporting 0-100 transfer progress, and
// resolves with the enqueued job id (import runs asynchronously).
export function uploadFiles(
  files: File[],
  onProgress: (pct: number) => void
): Promise<{ job_id: string; count: number }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append('file', f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/assets');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText || '{}'));
        } catch {
          resolve({ job_id: '', count: 0 });
        }
      } else {
        reject(new Error(`upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(form);
  });
}
