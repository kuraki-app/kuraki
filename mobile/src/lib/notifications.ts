import { Platform } from 'react-native';


import {
  shouldNotify,
  type NotificationKind,
} from '@/lib/notification-policy';
import { loadOptionalModule } from '@/lib/optional-native';
import { loadPrefs } from '@/lib/prefs';

// expo-notifications is native code. Requiring it lazily means a binary without
// it (Expo Go, or a dev client built before this dependency landed) degrades to
// notifications simply not firing, rather than throwing while this module
// evaluates and taking down whatever imported it — the same failure MapLibre
// caused on the Library route. See lib/optional-native.ts.
type NotificationsModule = typeof import('expo-notifications');
const Notifications = loadOptionalModule<NotificationsModule>(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require('expo-notifications'),
);

/** available reports whether this binary can post notifications at all. */
export function notificationsAvailable(): boolean {
  return Notifications !== null;
}

// Android will not display a notification that has no channel (API 26+), and a
// channel must exist before the first post. Created once, lazily.
let channelReady = false;
const ANDROID_CHANNEL = 'backup';

async function ensureAndroidChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android' || !Notifications) return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Backup',
    importance: Notifications.AndroidImportance.DEFAULT,
    // Backup progress is informational; it should not vibrate a phone at night.
    vibrationPattern: [0, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  channelReady = true;
}

/**
 * ensureNotificationPermission asks once, and reports whether posting is
 * allowed. Android 13+ requires POST_NOTIFICATIONS at runtime, and iOS requires
 * explicit authorisation; both are handled by requestPermissionsAsync.
 *
 * Never called from a headless background wake — see notify().
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * configureNotifications sets the foreground presentation behaviour. Without a
 * handler, iOS silently suppresses a notification posted while the app is open,
 * which reads as "notifications are broken" when testing.
 */
export function configureNotifications(): void {
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * notify posts a local notification if the user's preferences allow it.
 *
 * Deliberately quiet on every failure path: a notification is a courtesy, and
 * nothing here — a missing module, a denied permission, a rejected post — may
 * ever break the backup run that called it.
 *
 * `interactive` marks a call originating from a foreground action, where it is
 * legitimate to show a permission prompt. A background wake passes false: on
 * Android there is no Activity to attach a dialog to, so asking there fails
 * with nothing the user can see (the same trap the media-library permission hit).
 */
export async function notify(
  kind: NotificationKind,
  content: { title: string; body?: string },
  interactive = false,
): Promise<void> {
  if (!Notifications) return;
  try {
    if (!shouldNotify(kind, await loadPrefs())) return;

    const permission = interactive
      ? await ensureNotificationPermission()
      : (await Notifications.getPermissionsAsync()).granted;
    if (!permission) return;

    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: content.title,
        body: content.body,
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : {}),
      },
      trigger: null, // deliver now
    });
  } catch {
    // Courtesy only: never surface or rethrow.
  }
}

export { NOTIFICATION_KINDS, shouldNotify, type NotificationKind } from '@/lib/notification-policy';
