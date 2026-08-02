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
