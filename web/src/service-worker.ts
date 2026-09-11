/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import { drainUploads, PermanentUploadError, UPLOAD_SYNC_TAG } from '$lib/upload-queue';

const worker = self as unknown as ServiceWorkerGlobalScope;
const APP_FILES = [...build, ...files];

// `kit.version.name` is intentionally stable for the server binary. Include a
// digest of the generated filenames so a new web build still evicts its old
// shell instead of reusing it forever.
function shellRevision(values: string[]): string {
  let hash = 2166136261;
  for (const value of values) {
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36);
}

const CACHE = `kuraki-${version}-${shellRevision(APP_FILES)}`;
const SHELL_FILES = Array.from(new Set([...APP_FILES, '/']));

worker.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => worker.skipWaiting())
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('kuraki-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim())
  );
});

// Cache only the application shell. Private API/media responses always go to
// the network and never enter CacheStorage.
worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== worker.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          const cache = await caches.open(CACHE);
          await cache.put('/', response.clone());
          return response;
        })
        .catch(async () => (await caches.match('/')) ?? Response.error())
    );
    return;
  }

  if (APP_FILES.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
  }
});

type SyncEvent = ExtendableEvent & { tag: string };

async function sendBatch(filesToSend: File[]): Promise<unknown> {
  const form = new FormData();
  for (const file of filesToSend) form.append('file', file);
  const response = await fetch('/api/assets', {
    method: 'POST',
    body: form,
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403) {
      throw new PermanentUploadError(`Upload rejected (${response.status})`);
    }
    throw new Error(`Upload unavailable (${response.status})`);
  }
  return response.json().catch(() => ({}));
}

async function currentOwnerId(): Promise<string | null> {
  const response = await fetch('/api/me', { credentials: 'include' });
  if (!response.ok) return null;
  const body = (await response.json()) as { user?: { id?: string } };
  return body.user?.id ?? null;
}

async function notifyClients(message: Record<string, unknown>): Promise<void> {
  const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

worker.addEventListener('sync', ((event: SyncEvent) => {
  if (event.tag !== UPLOAD_SYNC_TAG) return;
  event.waitUntil(
    currentOwnerId().then(async (ownerId) => {
      if (!ownerId) throw new Error('Sign in to resume queued uploads');
      const result = await drainUploads(ownerId, sendBatch);
      const uploaded = result.sent.reduce((total, item) => total + item.files, 0);
      await notifyClients({ type: 'kuraki-upload-result', uploaded, failed: result.failedFiles, pending: result.files });
      if (result.retry) throw new Error('Uploads remain queued');
    })
  );
}) as EventListener);
