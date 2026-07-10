import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { backupEngine } from '@/lib/backup-engine';

// The OS wakes the app on its own schedule (Android >= ~15 min; iOS decides by
// usage and power). Each wake runs one pass of the same backup engine used in
// the foreground, so nothing is uploaded twice and failures are retried later.
export const BACKUP_TASK = 'kuraki-backup';

// defineTask must run at module load so the task exists when the OS relaunches
// the app headlessly. This module is imported from the root layout.
TaskManager.defineTask(BACKUP_TASK, async () => {
  const expiration = BackgroundTask.addExpirationListener(() => backupEngine.stop());
  try {
    await backupEngine.run();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
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
  return (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available;
}
