import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { backupEngine } from '@/lib/backup-engine';
import { drainBackgroundSync } from '@/lib/background-sync';
import { throwIfAborted } from '@/lib/request';

// The OS wakes the app on its own schedule (Android >= ~15 min; iOS decides by
// usage and power). Each wake runs one pass of the same backup engine used in
// the foreground, so nothing is uploaded twice and failures are retried later.
export const BACKUP_TASK = 'kuraki-backup';

// defineTask must run at module load so the task exists when the OS relaunches
// the app headlessly. This module is imported from the root layout.
TaskManager.defineTask(BACKUP_TASK, async () => {
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    backupEngine.stop();
  };
  const deadline = setTimeout(stop, 90_000);
  const expiration = BackgroundTask.addExpirationListener(stop);
  try {
    // Sync first, and always. It is cheap (a cursor-paginated delta feed plus
    // a mutation-queue drain) and it is the half of sync with no other
    // background trigger -- server-side edits previously reached the device
    // only while the app was open on the Library tab. Backup can consume the
    // entire window on a large library, so ordering it first would starve sync.
    await drainBackgroundSync(controller.signal);
    throwIfAborted(controller.signal);
    await backupEngine.run({ background: true, signal: controller.signal });
    throwIfAborted(controller.signal);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    clearTimeout(deadline);
    expiration.remove();
  }
});

/** enableBackgroundBackup registers periodic wakeups; returns false if the OS forbids them. */
export async function enableBackgroundBackup(): Promise<boolean> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  await BackgroundTask.registerTaskAsync(BACKUP_TASK, { minimumInterval: 15 });
  return true;
}

export async function disableBackgroundBackup(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(BACKUP_TASK)) {
    await BackgroundTask.unregisterTaskAsync(BACKUP_TASK);
  }
}

export async function backgroundAvailable(): Promise<boolean> {
  return (
    (await BackgroundTask.getStatusAsync()) ===
    BackgroundTask.BackgroundTaskStatus.Available
  );
}

/**
 * reconcileBackgroundBackup makes OS registration match the saved preference,
 * and must run on every launch.
 *
 * Registration previously happened only inside the Backup screen's switch
 * handler, making it a side effect of one tap rather than a fact about the
 * app's state. Anything that dropped the registration without going back
 * through that handler -- a reinstall, a restore onto a new device, an OS that
 * discarded the task, or simply a user who never revisited the screen -- left
 * `auto` persisted as true while nothing was scheduled, and automatic backup
 * silently stopped forever.
 *
 * Returns the resulting state so callers can report it honestly rather than
 * assuming success.
 */
export async function reconcileBackgroundBackup(): Promise<
  'registered' | 'unregistered' | 'unavailable'
> {
  const wanted = await backupEngine.isAuto();
  const registered = await TaskManager.isTaskRegisteredAsync(BACKUP_TASK);

  if (wanted && !registered) {
    return (await enableBackgroundBackup()) ? 'registered' : 'unavailable';
  }
  if (!wanted && registered) {
    await disableBackgroundBackup();
    return 'unregistered';
  }
  return wanted ? 'registered' : 'unregistered';
}
