import type { Prefs } from '@/lib/prefs';

export const NOTIFICATION_KINDS = ['backup-complete', 'backup-failed', 'disconnected'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// Each kind is gated by exactly one switch. Kept as a lookup rather than a
// switch statement so an unrecognised kind falls through to `undefined` and
// fails closed, instead of defaulting to "notify".
const PREF_FOR: Record<NotificationKind, keyof Prefs> = {
  'backup-complete': 'notifyBackupComplete',
  'backup-failed': 'notifyBackupFailed',
  disconnected: 'notifyDisconnected',
};

/**
 * shouldNotify is the whole notification policy.
 *
 * It lives in its own module, free of any react-native import, so it can be
 * unit-tested in the repo's node-only vitest setup — the module that actually
 * posts notifications needs Platform and cannot be loaded there.
 */
export function shouldNotify(kind: NotificationKind, prefs: Prefs): boolean {
  const pref = PREF_FOR[kind];
  return pref ? prefs[pref] === true : false;
}
