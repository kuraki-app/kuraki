import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFS } from '@/lib/prefs';
import { NOTIFICATION_KINDS, shouldNotify, type NotificationKind } from '@/lib/notification-policy';

describe('shouldNotify', () => {
  it('allows each kind when its own preference is on', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(shouldNotify(kind, DEFAULT_PREFS)).toBe(true);
    }
  });

  it('maps each kind to its own preference and no other', () => {
    // A kind must be gated by exactly one switch: turning off "backup finished"
    // must not silence a failure, which is the one people need.
    const cases: [NotificationKind, keyof typeof DEFAULT_PREFS][] = [
      ['backup-complete', 'notifyBackupComplete'],
      ['backup-failed', 'notifyBackupFailed'],
      ['disconnected', 'notifyDisconnected'],
    ];
    for (const [kind, pref] of cases) {
      expect(shouldNotify(kind, { ...DEFAULT_PREFS, [pref]: false })).toBe(false);
      for (const [other, otherPref] of cases) {
        if (other === kind) continue;
        expect(shouldNotify(other, { ...DEFAULT_PREFS, [pref]: false })).toBe(true);
        void otherPref;
      }
    }
  });

  it('silences everything when every switch is off', () => {
    const off = {
      ...DEFAULT_PREFS,
      notifyBackupComplete: false,
      notifyBackupFailed: false,
      notifyDisconnected: false,
    };
    for (const kind of NOTIFICATION_KINDS) {
      expect(shouldNotify(kind, off)).toBe(false);
    }
  });

  it('refuses an unrecognised kind rather than notifying', () => {
    // Fail closed: an unknown kind must not slip past the preferences.
    expect(shouldNotify('made-up' as NotificationKind, DEFAULT_PREFS)).toBe(false);
  });
});
