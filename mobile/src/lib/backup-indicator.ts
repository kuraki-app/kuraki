import type { BackupProgress } from '@/lib/backup-engine';

/**
 * What the Gallery header's backup item should be showing.
 *
 * `hidden` is the common case and is deliberately the resting state: automatic
 * backup spends most of its life queued-but-idle between OS wakes, and an
 * indicator that is permanently lit says nothing.
 */
export type IndicatorState = 'hidden' | 'syncing' | 'failed';

export type Indicator = {
  state: IndicatorState;
  /** 0-100, whole numbers. Meaningless unless `state` is `syncing`. */
  percent: number;
};

/** The slice of BackupProgress this reads — everything else is the engine's. */
type Input = Pick<BackupProgress, 'running' | 'pending' | 'done' | 'failed'>;

/**
 * backupIndicator reduces the engine's progress to one header item.
 *
 * The percentage is the *run's* progress (`done / (done + pending)`), not
 * `currentPercent`, which is how far the file currently uploading has got and
 * restarts at zero for every photo — a number that jitters between 0 and 100
 * all the way through a 400-photo backup tells the user nothing about whether
 * it is nearly over.
 *
 * Failures only surface once the run has stopped. A run that has already hit
 * one failure but is still working is still working, and showing the error
 * badge mid-run would report it as finished-and-broken.
 */
export function backupIndicator({ running, pending, done, failed }: Input): Indicator {
  if (running) {
    const total = done + pending;
    // A run that has not counted anything yet divides by zero; 0% is the honest
    // answer, NaN% is not.
    return { state: 'syncing', percent: total === 0 ? 0 : Math.round((done / total) * 100) };
  }
  if (failed.length > 0) return { state: 'failed', percent: 0 };
  return { state: 'hidden', percent: 0 };
}

/**
 * backupProgress reduces a run's counters to what a progress bar needs.
 *
 * `done` and `pending` are both live: `pending` is what is still queued, so the
 * total for this run is the two added together rather than either alone. That
 * total moves as the scanner discovers more items, which is why the fraction is
 * recomputed from both every tick instead of being anchored to a total captured
 * when the run started.
 *
 * The fraction is clamped to 0..1 so a late-arriving `done` (an upload
 * completing after the queue drained) cannot drive a bar past its track, and a
 * run with nothing in it reports 0 rather than dividing by zero.
 */
export function backupProgress(done: number, pending: number): { total: number; fraction: number } {
  const safeDone = Number.isFinite(done) && done > 0 ? Math.floor(done) : 0;
  const safePending = Number.isFinite(pending) && pending > 0 ? Math.floor(pending) : 0;
  const total = safeDone + safePending;
  if (total === 0) return { total: 0, fraction: 0 };
  return { total, fraction: Math.min(1, Math.max(0, safeDone / total)) };
}
