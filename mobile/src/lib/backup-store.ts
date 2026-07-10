import AsyncStorage from '@react-native-async-storage/async-storage';

// The backup state persists across app restarts so a completed item is never
// re-uploaded and a failure stays visible until it succeeds. `doneIds` is the
// set of local asset IDs the server has accepted (queued or completed); it is
// the client-side guard that makes restarts idempotent on top of the server's
// content-hash deduplication.

const stateKey = 'kuraki.backup.state.v1';

export type FailedItem = {
  localId: string;
  filename: string;
  error: string;
  at: number;
};

export type BackupState = {
  auto: boolean;
  doneIds: string[];
  failed: FailedItem[];
  lastSuccess: { filename: string; at: number } | null;
};

const empty: BackupState = { auto: false, doneIds: [], failed: [], lastSuccess: null };

export async function loadBackupState(): Promise<BackupState> {
  const raw = await AsyncStorage.getItem(stateKey);
  if (!raw) return { ...empty };
  try {
    const parsed = JSON.parse(raw) as Partial<BackupState>;
    return {
      auto: parsed.auto ?? false,
      doneIds: parsed.doneIds ?? [],
      failed: parsed.failed ?? [],
      lastSuccess: parsed.lastSuccess ?? null,
    };
  } catch {
    return { ...empty };
  }
}

export async function saveBackupState(state: BackupState): Promise<void> {
  await AsyncStorage.setItem(stateKey, JSON.stringify(state));
}
