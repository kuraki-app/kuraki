import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GroupBy } from '@/lib/gallery';

// Every user-facing preference in one record. They live together because they
// are read together (the grid needs three of them at once) and because a single
// stored blob keeps reads to one AsyncStorage round trip at launch.
export type Prefs = {
  // Backup
  backupPhotos: boolean;
  backupVideos: boolean;
  syncAlbums: boolean;
  // Notifications
  notifyBackupComplete: boolean;
  notifyBackupFailed: boolean;
  notifyDisconnected: boolean;
  // Photo grid
  gridColumns: number;
  gridGap: number;
  groupBy: GroupBy;
  showGroupHeaders: boolean;
  showBackupBadge: boolean;
};

export const GRID_COLUMNS = { min: 2, max: 6 } as const;
export const GRID_GAP = { min: 0, max: 12 } as const;

export const DEFAULT_PREFS: Prefs = {
  backupPhotos: true,
  backupVideos: true,
  syncAlbums: false,
  notifyBackupComplete: true,
  notifyBackupFailed: true,
  notifyDisconnected: true,
  gridColumns: 3,
  gridGap: 2,
  groupBy: 'month',
  showGroupHeaders: true,
  showBackupBadge: false,
};

const GROUP_VALUES: GroupBy[] = ['month', 'year', 'off'];

function bool(value: unknown, fallback: boolean): boolean {
  // Only a real boolean is honoured. A truthy string like 'no' from an older
  // build would otherwise flip a switch the user never touched.
  return typeof value === 'boolean' ? value : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * mergePrefs layers stored data over the defaults, validating every field.
 *
 * Pure, and deliberately total: preferences are cosmetic, so a half-written
 * record, a value from a newer build, or outright junk must degrade to the
 * default rather than throw and take the launch down with it.
 */
export function mergePrefs(stored: unknown): Prefs {
  const s: Record<string, unknown> =
    stored !== null && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};

  return {
    backupPhotos: bool(s.backupPhotos, DEFAULT_PREFS.backupPhotos),
    backupVideos: bool(s.backupVideos, DEFAULT_PREFS.backupVideos),
    syncAlbums: bool(s.syncAlbums, DEFAULT_PREFS.syncAlbums),
    notifyBackupComplete: bool(s.notifyBackupComplete, DEFAULT_PREFS.notifyBackupComplete),
    notifyBackupFailed: bool(s.notifyBackupFailed, DEFAULT_PREFS.notifyBackupFailed),
    notifyDisconnected: bool(s.notifyDisconnected, DEFAULT_PREFS.notifyDisconnected),
    gridColumns: clampInt(s.gridColumns, GRID_COLUMNS.min, GRID_COLUMNS.max, DEFAULT_PREFS.gridColumns),
    gridGap: clampInt(s.gridGap, GRID_GAP.min, GRID_GAP.max, DEFAULT_PREFS.gridGap),
    groupBy: GROUP_VALUES.includes(s.groupBy as GroupBy) ? (s.groupBy as GroupBy) : DEFAULT_PREFS.groupBy,
    showGroupHeaders: bool(s.showGroupHeaders, DEFAULT_PREFS.showGroupHeaders),
    showBackupBadge: bool(s.showBackupBadge, DEFAULT_PREFS.showBackupBadge),
  };
}

const KEY = 'kuraki.prefs';

// A synchronous mirror so screens can render the right thing on first paint
// instead of flashing defaults, matching the setup-complete pattern in
// settings.ts. Null means "not read from storage yet".
let mirror: Prefs | null = null;
const listeners = new Set<() => void>();

export function prefsSnapshot(): Prefs | null {
  return mirror;
}

export function onPrefsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadPrefs(): Promise<Prefs> {
  if (mirror) return mirror;
  let parsed: unknown;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined; // unreadable or malformed: fall back to defaults
  }
  mirror = mergePrefs(parsed);
  return mirror;
}

/** savePrefs applies a patch, persists the whole record, and notifies readers. */
export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = mergePrefs({ ...(mirror ?? (await loadPrefs())), ...patch });
  mirror = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Keep the in-memory value: the UI stays consistent for this session even
    // if the write failed, and the next write will retry.
  }
  for (const l of listeners) l();
  return next;
}
