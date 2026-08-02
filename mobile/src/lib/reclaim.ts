/**
 * Which camera-roll items may be removed from this device, and what that would
 * free.
 *
 * Pure, and separated from the screen on purpose: this is the code that decides
 * whether someone's photograph gets deleted, and it should be provable without
 * a simulator, a camera roll, or a server.
 */

/** The fields this needs off an expo-media-library asset. */
export type LocalAsset = {
  id: string;
  /** Epoch ms. Absent on some assets, which is treated as "too recent". */
  creationTime?: number;
  /** Bytes. Absent when the OS did not report one. */
  size?: number;
};

/**
 * The retention windows offered, in days. `-1` is "keep everything", and it is
 * first because it is the safe end of the range and the default.
 */
export const RETENTION_DAYS = [-1, 7, 30, 90, 365] as const;

export type RetentionDays = (typeof RETENTION_DAYS)[number];

const DAY = 24 * 60 * 60 * 1000;

/**
 * reclaimable returns the assets that are safe to delete locally.
 *
 * Two conditions, both required, and both failing *closed*:
 *
 *  1. **The ledger says the server has it.** `backedUpIds` comes from
 *     `loadBackedUpIds()`, which only records ids the server accepted. Anything
 *     absent is not offered — an asset the app merely believes it uploaded is
 *     not evidence, and the cost of being wrong is someone's photograph.
 *  2. **It is older than the retention window.** Recent photos are the ones
 *     people open, and a backup server is not a substitute for the phone's own
 *     library on the day of a trip.
 *
 * An asset with no creation time is kept: unknown age cannot be shown to be
 * outside the window, and the safe reading of unknown is "too recent". An asset
 * dated in the future is kept for the same reason — that is a clock skew or a
 * bad EXIF date, not a very old photo.
 *
 * `retentionDays < 0` means keep everything, and returns nothing at all.
 */
export function reclaimable(
  assets: LocalAsset[],
  backedUpIds: Set<string>,
  retentionDays: number,
  now: number = Date.now(),
): LocalAsset[] {
  if (retentionDays < 0) return [];
  const cutoff = now - retentionDays * DAY;
  return assets.filter((a) => {
    if (!backedUpIds.has(a.id)) return false;
    if (typeof a.creationTime !== 'number' || !Number.isFinite(a.creationTime)) return false;
    if (a.creationTime > now) return false;
    // Strictly older than the cutoff: "keep for 30 days" includes the 30th.
    return a.creationTime < cutoff;
  });
}

/** reclaimSummary totals what deleting the given assets would free. */
export function reclaimSummary(assets: LocalAsset[]): { count: number; bytes: number } {
  return {
    count: assets.length,
    bytes: assets.reduce((sum, a) => sum + (typeof a.size === 'number' ? a.size : 0), 0),
  };
}
