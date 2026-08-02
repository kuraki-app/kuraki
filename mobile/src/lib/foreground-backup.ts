/** The shortest gap between two foreground backup passes. */
export const FOREGROUND_BACKUP_MIN_GAP_MS = 60_000;

/**
 * shouldRunForegroundBackup decides whether a foreground pass is due.
 *
 * Pure so it can be tested without a camera roll: the scan behind it walks the
 * entire library, which is far too expensive to repeat every time the user
 * flicks between apps. `lastRunAt` of 0 means "never run this launch", which
 * always qualifies — the pass on app open is the one that matters most.
 */
export function shouldRunForegroundBackup(
  auto: boolean,
  lastRunAt: number,
  now: number,
  minGapMs: number = FOREGROUND_BACKUP_MIN_GAP_MS,
): boolean {
  if (!auto) return false;
  if (lastRunAt <= 0) return true;
  // A clock that moved backwards (timezone change, NTP correction) must not
  // lock backup out until the clock catches up again.
  if (now < lastRunAt) return true;
  return now - lastRunAt >= minGapMs;
}
