import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider, useSegments } from 'expo-router';
import { Image } from 'expo-image';
import { AppState, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useTokens } from '@/constants/theme';
import { useAppFonts } from '@/design/fonts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { backupEngine } from '@/lib/backup-engine';
import { shouldRunForegroundBackup } from '@/lib/foreground-backup';
import { isSetupComplete, migrateSecretsForBackgroundAccess, onSetupChange, setupCompleteSnapshot } from '@/lib/settings';
// Importing this at the root defines the background backup task before the OS
// can relaunch the app headlessly to run it. Defining the task is a module
// side effect; reconcileBackgroundBackup below is what actually schedules it.
import { reconcileBackgroundBackup } from '@/lib/background';
import { configureNotifications } from '@/lib/notifications';

// A 512 MB LRU disk cap so the thumbnail/preview cache expo-image keeps for
// the library grid and viewer can't grow unbounded on the device.
//
// iOS only: expo-image implements configureCache in ios/ImageModule.swift and
// has no Android counterpart, so calling it unguarded here threw while the
// root layout module was still evaluating -- crashing every Android launch
// before any UI rendered. Android's cache is governed by Glide's own defaults.
if (Platform.OS === 'ios') {
  Image.configureCache({ maxDiskSize: 512 * 1024 * 1024 });
}

// Without a foreground handler iOS silently suppresses a notification posted
// while the app is open, which reads as "notifications are broken". Safe at
// module scope: it no-ops when the native module is absent.
configureNotifications();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const tokens = useTokens();
  const fontsLoaded = useAppFonts();
  const [ready, setReady] = useState<boolean | null>(setupCompleteSnapshot());
  const segments = useSegments();

  // The navigation theme has to be built from the Kuraki tokens, not taken
  // from react-navigation's stock DefaultTheme/DarkTheme.
  //
  // Everything the OS draws for us -- native headers, the screen background
  // behind a push transition, the tab bar -- reads its colours from here. With
  // the stock themes those surfaces were plain #fff/#000 while every view the
  // app itself painted used the warm paper palette, so any native chrome
  // arrived in the wrong colour and each screen had to paint over it by hand.
  const navigationTheme = useMemo(() => {
    const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: tokens.primary,
        background: tokens.background,
        card: tokens.card,
        text: tokens.foreground,
        border: tokens.border,
        notification: tokens.destructive,
      },
    };
  }, [colorScheme, tokens]);

  useEffect(() => {
    void isSetupComplete().then(setReady);
    return onSetupChange(() => setReady(setupCompleteSnapshot()));
  }, []);

  // Launch-time reconciliation, deliberately not tied to any screen.
  //
  // Background registration used to happen only inside the Backup screen's
  // switch handler, so a persisted "auto backup on" could outlive the actual OS
  // registration -- after a reinstall, a device restore, or simply a user who
  // never opened that screen again -- and backup stopped with no indication.
  // The keychain rewrite is the matching one-off: credentials written before
  // the AFTER_FIRST_UNLOCK change stay unreadable to a locked-device background
  // wake until they are re-saved once.
  useEffect(() => {
    void (async () => {
      try {
        await migrateSecretsForBackgroundAccess();
        await reconcileBackgroundBackup();
      } catch {
        // Never block startup on this; the Backup screen still reports the
        // real registration state, and the next launch retries.
      }
    })();
  }, []);

  // Automatic backup has to run while the app is open, not only from an OS wake.
  //
  // Nothing triggered `backupEngine.run()` in the foreground at all: the switch
  // handler starts one pass when it is flipped on, and after that the only
  // trigger was the background task. Android schedules that no more often than
  // ~15 minutes, and iOS grants a window on its own judgement of usage and
  // power -- which for a freshly installed app, or one running from a dev
  // build, can mean effectively never. So "automatic backup" was on, correctly
  // registered, and visibly doing nothing.
  //
  // App-wide rather than on the Gallery screen deliberately: the same mistake
  // put the delta sync behind one tab, where a user parked anywhere else never
  // got it. Rate-limited because the scan walks the whole camera roll.
  const lastForegroundBackup = useRef(0);
  useEffect(() => {
    const pass = () => {
      void (async () => {
        try {
          if (!shouldRunForegroundBackup(await backupEngine.isAuto(), lastForegroundBackup.current, Date.now())) {
            return;
          }
          lastForegroundBackup.current = Date.now();
          // Foreground, so this pass may prompt for photo access if it is
          // missing -- the headless wake deliberately cannot.
          await backupEngine.run();
        } catch {
          // The engine reports its own state through the Backup and Activity
          // screens; a failed pass must never take the app down at launch.
        }
      })();
    };

    pass();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') pass();
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded || ready === null) {
    return <View style={{ flex: 1 }} />; // splash stays up
  }

  const inSetup = segments[0] === '(setup)';
  // The gate's authority is the persisted flag, NEVER token presence — a 401
  // clears the token but must never eject a set-up user to onboarding.
  const redirect = !ready && !inSetup ? '/(setup)/welcome' : ready && inSetup ? '/(app)/(gallery)' : null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Nothing below this measured the notch/Dynamic Island before: screens
          drew under the status bar and the tab bar owned the bottom inset
          natively. The custom tab bar makes both insets ours to handle, so the
          provider has to exist app-wide. */}
      <SafeAreaProvider>
        <ThemeProvider value={navigationTheme}>
          {redirect ? <Redirect href={redirect} /> : <Slot />}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
