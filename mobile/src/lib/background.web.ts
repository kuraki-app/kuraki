// Web has no OS background task scheduler; keep the public API so the Backup
// screen can import the same helpers without pulling native-only modules.

export const BACKUP_TASK = 'kuraki-backup';

export async function enableBackgroundBackup(): Promise<boolean> {
  return false;
}

export async function disableBackgroundBackup(): Promise<void> {}

export async function backgroundAvailable(): Promise<boolean> {
  return false;
}

export async function reconcileBackgroundBackup(): Promise<'registered' | 'unregistered' | 'unavailable'> {
  return 'unavailable';
}
