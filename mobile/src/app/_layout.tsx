import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider, useSegments } from 'expo-router';
import { Image } from 'expo-image';
import { useColorScheme, View } from 'react-native';
import { useEffect, useState } from 'react';

import { useAppFonts } from '@/design/fonts';
import { isSetupComplete, onSetupChange, setupCompleteSnapshot } from '@/lib/settings';
// Importing this at the root defines the background backup task before the OS
// can relaunch the app headlessly to run it.
import '@/lib/background';

// A 512 MB LRU disk cap so the thumbnail/preview cache expo-image keeps for
// the library grid and viewer can't grow unbounded on the device.
Image.configureCache({ maxDiskSize: 512 * 1024 * 1024 });

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const fontsLoaded = useAppFonts();
  const [ready, setReady] = useState<boolean | null>(setupCompleteSnapshot());
  const segments = useSegments();

  useEffect(() => {
    void isSetupComplete().then(setReady);
    return onSetupChange(() => setReady(setupCompleteSnapshot()));
  }, []);

  if (!fontsLoaded || ready === null) {
    return <View style={{ flex: 1 }} />; // splash stays up
  }

  const inSetup = segments[0] === '(setup)';
  // The gate's authority is the persisted flag, NEVER token presence — a 401
  // clears the token but must never eject a set-up user to onboarding.
  const redirect = !ready && !inSetup ? '/(setup)/welcome' : ready && inSetup ? '/(app)' : null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {redirect ? <Redirect href={redirect} /> : <Slot />}
    </ThemeProvider>
  );
}
