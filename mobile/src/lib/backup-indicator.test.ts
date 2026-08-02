import { describe, expect, it } from 'vitest';
import { backupIndicator } from '@/lib/backup-indicator';

const idle = { running: false, pending: 0, done: 0, failed: [] };
const failure = { localId: 'a', filename: 'a.jpg', error: 'boom', at: 0 };

describe('backupIndicator', () => {
  it('shows nothing when there is nothing to say', () => {
    expect(backupIndicator(idle).state).toBe('hidden');
  });

  it('reports progress across the whole run, not the current file', () => {
    // 3 of 10 done: the number the user cares about is how far the run has
    // got, not how far one photo's upload has got.
    expect(backupIndicator({ ...idle, running: true, done: 3, pending: 7 })).toEqual({
      state: 'syncing',
      percent: 30,
    });
  });

  it('does not divide by zero on a run that has counted nothing yet', () => {
    expect(backupIndicator({ ...idle, running: true })).toEqual({ state: 'syncing', percent: 0 });
  });

  it('rounds rather than showing a fraction', () => {
    expect(backupIndicator({ ...idle, running: true, done: 1, pending: 2 }).percent).toBe(33);
  });

  it('reports failures once the run has stopped', () => {
    expect(backupIndicator({ ...idle, failed: [failure] }).state).toBe('failed');
  });

  it('prefers progress over failures while still running', () => {
    // A run that already hit one failure is still a run in progress; showing
    // the error badge would report it as finished-and-broken.
    expect(backupIndicator({ ...idle, running: true, done: 1, pending: 1, failed: [failure] }).state).toBe(
      'syncing',
    );
  });

  it('treats a finished run as nothing to show, not as stuck at 100%', () => {
    expect(backupIndicator({ ...idle, done: 12 }).state).toBe('hidden');
  });

  it('stays hidden when work is queued but nothing is running', () => {
    // Queued-but-idle is the resting state of automatic backup between wakes.
    // An indicator here would be permanently on for anyone with auto backup.
    expect(backupIndicator({ ...idle, pending: 40 }).state).toBe('hidden');
  });
});
