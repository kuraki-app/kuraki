// Each tab owns a live cursor; persistence is scoped to the library account.
// Reading a shared cursor on every poll lets a faster tab hide updates from a
// slower one. A restored server whose head moved backwards requests a reset.
import { api } from './api';
import { bumpLibrary } from './stores';

const POLL_ACTIVE_MS = 15_000;
const POLL_BACKUP_MS = 60_000;

export function syncCursorKey(ownerId: string): string {
  return `kuraki:sync-cursor:${ownerId}`;
}

export function startSync(ownerId: string): () => void {
  const key = syncCursorKey(ownerId);
  let cursor = 0;
  try {
    const saved = Number(localStorage.getItem(key) ?? 0);
    if (Number.isSafeInteger(saved) && saved >= 0) cursor = saved;
  } catch { /* Storage can be unavailable in a private browser session. */ }

  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let source: EventSource | null = null;
  const abort = new AbortController();

  function saveCursor(value: number) {
    cursor = value;
    try { localStorage.setItem(key, String(value)); } catch { /* Keep the live cursor. */ }
  }

  async function pollOnce(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      let changed = false;
      for (let page = 0; page < 20 && !stopped; page++) {
        const result = await api.changes(cursor, undefined, ownerId, abort.signal);
        if (stopped) return;
        saveCursor(result.cursor);
        if (result.reset) { changed = true; break; }
        if (result.changes.length) changed = true;
        if (!result.has_more) break;
      }
      if (changed && !stopped) bumpLibrary();
    } catch { /* Keep the cursor and retry after a transient failure. */ }
    finally { inFlight = false; }
  }

  function startInterval(ms: number) {
    if (stopped) return;
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void pollOnce();
    }, ms);
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') void pollOnce();
  };
  void pollOnce();
  if (typeof EventSource !== 'undefined') {
    source = new EventSource('/api/events', { withCredentials: true });
    source.addEventListener('change', () => void pollOnce());
    source.addEventListener('open', () => startInterval(POLL_BACKUP_MS));
    source.addEventListener('error', () => startInterval(POLL_ACTIVE_MS));
    startInterval(POLL_BACKUP_MS);
  } else startInterval(POLL_ACTIVE_MS);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    abort.abort();
    if (timer) clearInterval(timer);
    source?.close();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}
