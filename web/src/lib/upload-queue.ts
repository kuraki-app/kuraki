/**
 * Persistent browser upload queue shared by the page and service worker.
 *
 * The interface stays deliberately small: enqueue, inspect, and drain. The
 * caller supplies the upload adapter, so the foreground can use XHR progress
 * while the service worker uses fetch without duplicating queue semantics.
 */

const DB_NAME = 'kuraki-upload-queue';
const DB_VERSION = 1;
const STORE = 'batches';
const LEASE_MS = 5 * 60 * 1000;

export const UPLOAD_SYNC_TAG = 'kuraki-upload-queue';

type StoredBatch = {
  id: string;
  ownerId: string;
  createdAt: number;
  files: File[];
  state: 'queued' | 'sending';
  leaseUntil: number;
};

export class PermanentUploadError extends Error {}

export type UploadQueueState = {
  batches: number;
  files: number;
};

export type UploadDrainResult<T> = UploadQueueState & {
  sent: Array<{ value: T; files: number }>;
  failedFiles: number;
  retry: boolean;
};

const activeDrains = new Map<string, Promise<UploadDrainResult<unknown>>>();

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('Upload queue request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Upload queue transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('Upload queue transaction failed'));
  });
}

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) {
        open.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('Could not open the upload queue'));
  });
}

async function readAll(db: IDBDatabase, ownerId?: string): Promise<StoredBatch[]> {
  const tx = db.transaction(STORE, 'readonly');
  const rows = await request(tx.objectStore(STORE).getAll() as IDBRequest<StoredBatch[]>);
  await transactionDone(tx);
  return rows
    .filter((row) => !ownerId || row.ownerId === ownerId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function stateOf(rows: StoredBatch[]): UploadQueueState {
  return {
    batches: rows.length,
    files: rows.reduce((total, row) => total + row.files.length, 0)
  };
}

/** Queue each selected file independently. One unsupported file can then be
 * discarded without losing the valid photos selected beside it, and a retry
 * resumes at the next unsent file instead of repeating the whole selection. */
export async function enqueueUploads(files: File[], ownerId: string): Promise<UploadQueueState> {
  if (!files.length) return uploadQueueState(ownerId);
  const db = await openQueue();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const createdAt = Date.now();
    for (const [index, file] of files.entries()) {
      store.put({
        id: crypto.randomUUID(),
        ownerId,
        createdAt: createdAt + index,
        files: [file],
        state: 'queued',
        leaseUntil: 0
      } satisfies StoredBatch);
    }
    await transactionDone(tx);
    return stateOf(await readAll(db, ownerId));
  } finally {
    db.close();
  }
}

export async function uploadQueueState(ownerId: string): Promise<UploadQueueState> {
  const db = await openQueue();
  try {
    return stateOf(await readAll(db, ownerId));
  } finally {
    db.close();
  }
}

/** Claiming is transactional, so the page and service worker cannot send the
 * same batch unless a sender outlives its five-minute crash-recovery lease. */
async function claimNext(db: IDBDatabase, ownerId: string): Promise<StoredBatch | null> {
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const rows = await request(store.getAll() as IDBRequest<StoredBatch[]>);
  const now = Date.now();
  const next = rows
    .filter((row) => row.ownerId === ownerId && (row.state === 'queued' || row.leaseUntil <= now))
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (next) {
    next.state = 'sending';
    next.leaseUntil = now + LEASE_MS;
    store.put(next);
  }
  await transactionDone(tx);
  return next ?? null;
}

async function removeBatch(db: IDBDatabase, id: string): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await transactionDone(tx);
}

async function releaseBatch(db: IDBDatabase, batch: StoredBatch): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ ...batch, state: 'queued', leaseUntil: 0 } satisfies StoredBatch);
  await transactionDone(tx);
}

/** Drain until empty or a retryable error occurs. Permanent client errors are
 * removed so one unsupported file cannot block every photo behind it. */
export async function drainUploads<T>(
  ownerId: string,
  send: (files: File[]) => Promise<T>
): Promise<UploadDrainResult<T>> {
  const active = activeDrains.get(ownerId);
  if (active) return active as Promise<UploadDrainResult<T>>;

  const running = (async () => {
    const db = await openQueue();
    const sent: Array<{ value: T; files: number }> = [];
    let failedFiles = 0;
    let retry = false;
    try {
      while (true) {
        const batch = await claimNext(db, ownerId);
        if (!batch) break;
        try {
          const value = await send(batch.files);
          sent.push({ value, files: batch.files.length });
          await removeBatch(db, batch.id);
        } catch (error) {
          if (error instanceof PermanentUploadError) {
            failedFiles += batch.files.length;
            await removeBatch(db, batch.id);
            continue;
          }
          await releaseBatch(db, batch);
          retry = true;
          break;
        }
      }
      const remaining = stateOf(await readAll(db, ownerId));
      // A different context may currently hold a lease. A background sync must
      // retry later rather than declare the queue finished while that sender
      // can still be terminated by the browser.
      if (remaining.files > 0) retry = true;
      return { ...remaining, sent, failedFiles, retry };
    } finally {
      db.close();
    }
  })();

  activeDrains.set(ownerId, running as Promise<UploadDrainResult<unknown>>);
  try {
    return await running;
  } finally {
    if (activeDrains.get(ownerId) === running) activeDrains.delete(ownerId);
  }
}
