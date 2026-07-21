// Delta-sync consumer for the web client.
//
// The server keeps an owner-scoped change_log and exposes it as a thin,
// cursor-paginated feed at GET /api/changes (id/entity/op only — no payload).
// This poller drains the feed and, when anything changed, calls bumpLibrary()
// so open library views reload through the app's existing invalidation path.
//
// Why bump-and-reload rather than surgically patching each changed asset into
// the in-memory timeline: the web timeline is day-grouped and (soon)
// virtualized, so applying an out-of-order create/delete correctly means
// re-deriving groups anyway. The feed's job here is to answer "did anything
// change elsewhere (e.g. from the phone)?" — the reload is already cheap and
// correct. A future richer client can consume `entity_id`/`op` directly; the
// cursor contract is the same either way.
//
// The cursor is persisted per-origin so a reload/tab-reopen resumes instead of
// replaying from 0 (which would bump the library once on every page load).

import { api } from './api';
import { bumpLibrary } from './stores';

const CURSOR_KEY = 'kuraki:sync-cursor';
// Poll cadence. Short when SSE is unavailable/disconnected (the sole freshness
// mechanism), long when SSE is connected (a mere safety net behind push).
const POLL_ACTIVE_MS = 15_000;
const POLL_BACKUP_MS = 60_000;

function readCursor(): number {
  if (typeof localStorage === 'undefined') return 0;
  const raw = localStorage.getItem(CURSOR_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function writeCursor(n: number) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(CURSOR_KEY, String(n));
}

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

// pollOnce drains as many pages as the feed offers this tick, so a large batch
// of changes (e.g. a bulk import that happened while the tab was closed) is
// caught up in one wake rather than one page per interval. It bumps the library
// at most once regardless of how many pages/changes were seen.
async function pollOnce(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    let changed = false;
    // Bound the catch-up loop so a runaway feed can't spin forever in one tick.
    for (let page = 0; page < 20; page++) {
      const res = await api.changes(readCursor());
      if (res.changes.length > 0) changed = true;
      writeCursor(res.cursor);
      if (!res.has_more) break;
    }
    if (changed) bumpLibrary();
  } catch {
    // Offline or a transient 5xx: keep the cursor, retry next tick. A 401 is
    // handled by req() flipping the session to logged-out, which stops us.
  } finally {
    inFlight = false;
  }
}

let source: EventSource | null = null;

// startInterval starts (or restarts) the fallback poll timer at the given
// cadence, replacing any existing one.
function startInterval(ms: number) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    void pollOnce();
  }, ms);
}

/**
 * startSync begins syncing the delta feed. Primary path is Server-Sent Events
 * (`/api/events`): the server pushes a wakeup the instant change_log advances,
 * and each wakeup drains the owner-scoped cursor feed — so SSE replaces the poll
 * timer rather than the feed. A slow fallback poll runs behind it (long while
 * SSE is connected, short when it drops) so freshness never depends on the
 * stream staying up. Idempotent; returns a stop function.
 *
 * Skips work while the tab is hidden and fires one drain on regaining
 * visibility so a returning user sees fresh data immediately.
 */
export function startSync(): () => void {
  if (timer || source) return () => {};
  const onVisible = () => {
    if (document.visibilityState === 'visible') void pollOnce();
  };

  // Always drain once on start (covers changes made while away, and primes the
  // cursor); then let SSE drive, with the fallback poll behind it.
  void pollOnce();

  if (typeof EventSource !== 'undefined') {
    source = new EventSource('/api/events', { withCredentials: true });
    // A `change` push means change_log advanced — drain from our cursor.
    source.addEventListener('change', () => void pollOnce());
    // On open, relax the fallback poll to a slow safety net.
    source.addEventListener('open', () => startInterval(POLL_BACKUP_MS));
    // On error the browser auto-reconnects; meanwhile tighten the poll so the
    // gap is covered by the fallback at the active cadence.
    source.addEventListener('error', () => startInterval(POLL_ACTIVE_MS));
    startInterval(POLL_BACKUP_MS);
  } else {
    // No EventSource (very old browser): polling is the only mechanism.
    startInterval(POLL_ACTIVE_MS);
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (source) source.close();
    source = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}
