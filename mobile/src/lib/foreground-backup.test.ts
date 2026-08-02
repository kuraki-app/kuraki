import { describe, expect, it } from 'vitest';

import { FOREGROUND_BACKUP_MIN_GAP_MS, shouldRunForegroundBackup } from '@/lib/foreground-backup';

describe('shouldRunForegroundBackup', () => {
  const now = 1_800_000_000_000;

  it('never runs while automatic backup is off', () => {
    expect(shouldRunForegroundBackup(false, 0, now)).toBe(false);
    expect(shouldRunForegroundBackup(false, now - 10 * FOREGROUND_BACKUP_MIN_GAP_MS, now)).toBe(false);
  });

  it('always runs the first pass of a launch', () => {
    // This is the pass that matters most: it is what makes backup start when
    // the user opens the app, rather than waiting for an OS window that iOS
    // may not grant for days.
    expect(shouldRunForegroundBackup(true, 0, now)).toBe(true);
  });

  it('does not rescan the whole camera roll on a quick app switch', () => {
    expect(shouldRunForegroundBackup(true, now - 1_000, now)).toBe(false);
    expect(shouldRunForegroundBackup(true, now - (FOREGROUND_BACKUP_MIN_GAP_MS - 1), now)).toBe(false);
  });

  it('runs again once the gap has elapsed', () => {
    expect(shouldRunForegroundBackup(true, now - FOREGROUND_BACKUP_MIN_GAP_MS, now)).toBe(true);
  });

  it('is not locked out by a clock that moved backwards', () => {
    // A timezone change or an NTP correction must not disable backup until the
    // clock catches up.
    expect(shouldRunForegroundBackup(true, now + 60 * 60 * 1000, now)).toBe(true);
  });
});
