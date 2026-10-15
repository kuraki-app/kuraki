import AsyncStorage from '@react-native-async-storage/async-storage';

// Small, bounded backup settings and recent failures. The much larger set of
// already-uploaded asset ids lives in the SQLite ledger (backup-ledger.ts), not
// here: it was previously a `doneIds` JSON array rewritten in full on every
// successful item, which on Android hit AsyncStorage's 6 MB database cap and
// 2 MB single-row ceiling once a library grew. `legacyDoneIds` is read once so
// existing installs migrate into the ledger instead of re-uploading everything.

const stateKey = 'kuraki.backup.state.v1';

export type FailedItem = {
  localId: string;
  filename: string;
  error: string;
  at: number;
};

export type BackupState = {
  scan?: { scope: string; album: number; after?: string };
  auto: boolean;
  failed: FailedItem[];
  lastSuccess: { filename: string; at: number } | null;
  // Device album IDs to back up. Empty means the whole library.
  albumIds: string[];
  // Restrict automatic backup to un-metered connections. Defaults ON: a
  // background wake can otherwise push a whole camera roll over cellular.
  wifiOnly: boolean;
  // Only ever populated by a read of the pre-ledger format; see the note above.
  legacyDoneIds: string[];
};

const empty: BackupState = {
  auto: false,
  failed: [],
  lastSuccess: null,
  albumIds: [],
  wifiOnly: true,
  legacyDoneIds: [],
};

export async function loadBackupState(library?: string): Promise<BackupState> {
  // The read itself is inside the guard: on Android a row that outgrew the
  // CursorWindow throws here, and letting that escape took down every caller
  // (run, setAuto, subscribe) rather than degrading to defaults.
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(stateKey);
  } catch {
    return { ...empty };
  }
  if (!raw) return { ...empty };
  try {
    const history = library
      ? await AsyncStorage.getItem(`${stateKey}.library.${library}`)
      : null;
    const scoped = history ? (JSON.parse(history) as Partial<BackupState>) : {};
    const parsed = JSON.parse(raw) as Partial<BackupState> & {
      doneIds?: string[];
    };
    return {
      auto: parsed.auto === true,
      failed: Array.isArray(scoped.failed) ? scoped.failed : [],
      lastSuccess: scoped.lastSuccess ?? null,
      scan: scoped.scan,
      albumIds: Array.isArray(parsed.albumIds)
        ? parsed.albumIds.filter((id) => typeof id === 'string')
        : [],
      wifiOnly: parsed.wifiOnly !== false,
      legacyDoneIds: parsed.doneIds ?? [],
    };
  } catch {
    return { ...empty };
  }
}

export async function saveBackupState(
  state: BackupState,
  library?: string,
): Promise<void> {
  // legacyDoneIds is never written back -- persisting it would recreate the
  // unbounded array this format was moved away from.
  const { legacyDoneIds: _drop, ...persisted } = state;
  const { failed, lastSuccess, scan, ...preferences } = persisted;
  await AsyncStorage.setItem(stateKey, JSON.stringify(preferences));
  if (library)
    await AsyncStorage.setItem(
      `${stateKey}.library.${library}`,
      JSON.stringify({ failed, lastSuccess, scan }),
    );
}
