import { session } from './stores';
import type { Album, Asset, AssetList, DupAsset, Job, LibraryStats, MediaIssue, PlaceGroup, SavedSearch, SetupStatus, Tag } from './types';

export type AssetPatch = {
  taken_at?: string;
  description?: string;
  gps_lat?: number;
  gps_lon?: number;
  clear_gps?: boolean;
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
  archived?: string;
  hidden?: string;
};

export const api = {
  setupStatus: () => req<SetupStatus>('/api/setup'),
  setup: (username: string, password: string) =>
    req<SetupStatus>('/api/setup', jsonBody({ username, password })),
  login: (username: string, password: string) =>
    req<SetupStatus>('/api/login', jsonBody({ username, password })),
  logout: () => req<void>('/api/logout', { method: 'POST' }),

  assets: (cursor = '') =>
    req<AssetList>(`/api/assets?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  search: (params: SearchParams) => {
    const p = new URLSearchParams({ limit: '300' });
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    return req<AssetList>(`/api/search?${p.toString()}`);
  },
  favorites: () => req<AssetList>('/api/favorites?limit=500'),
  memories: (date = '') =>
    req<AssetList>(`/api/memories?limit=500${date ? `&date=${date}` : ''}`),
  trash: () => req<AssetList>('/api/trash?limit=500'),
  archived: () => req<AssetList>('/api/assets?archived=1&limit=500'),
  hidden: () => req<AssetList>('/api/assets?hidden=1&limit=500'),

  setFavorite: (id: string, favorite: boolean) =>
    req<void>(`/api/assets/${id}/favorite`, jsonBody({ favorite })),
  patchAsset: (id: string, patch: AssetPatch) => req<Asset>(`/api/assets/${id}`, jsonBody(patch, 'PATCH')),
  shiftTime: (ids: string[], minutes: number) =>
    req<{ updated: number }>('/api/assets/shift-time', jsonBody({ ids, minutes })),
  remove: (id: string) => req<void>(`/api/assets/${id}`, { method: 'DELETE' }),
  restore: (id: string) => req<void>(`/api/assets/${id}/restore`, { method: 'POST' }),
  batch: (op: 'delete' | 'restore' | 'favorite' | 'unfavorite' | 'archive' | 'unarchive' | 'hide' | 'unhide', ids: string[]) =>
    req<{ succeeded: number }>('/api/assets/batch', jsonBody({ op, ids })),

  albums: () => req<{ albums: Album[] }>('/api/albums'),
  album: (id: string) => req<AssetList>(`/api/albums/${id}?limit=500`),
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
  job: (id: string) => req<Job>(`/api/jobs/${id}`),
  mediaIssues: () => req<{ issues: MediaIssue[] }>('/api/media/issues'),
  rebuildAsset: (id: string) => req<{ status: string }>(`/api/assets/${id}/rebuild`, { method: 'POST' }),
  duplicates: () => req<{ groups: DupAsset[][] }>('/api/duplicates'),
  tags: () => req<{ tags: Tag[] }>('/api/tags'),
  createTag: (name: string, parent_id?: string) => req<Tag>('/api/tags', jsonBody({ name, parent_id })),
  deleteTag: (id: string) => req<void>(`/api/tags/${id}`, { method: 'DELETE' }),
  assetTags: (id: string) => req<{ tags: Tag[] }>(`/api/assets/${id}/tags`),
  setAssetTags: (id: string, ids: string[]) => req<{ tags: Tag[] }>(`/api/assets/${id}/tags`, jsonBody({ ids }, 'PUT')),
  savedSearches: () => req<{ saved_searches: SavedSearch[] }>('/api/saved-searches'),
  createSavedSearch: (name: string, query: Record<string, string>) => req<SavedSearch>('/api/saved-searches', jsonBody({ name, query })),
  deleteSavedSearch: (id: string) => req<void>(`/api/saved-searches/${id}`, { method: 'DELETE' })
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
