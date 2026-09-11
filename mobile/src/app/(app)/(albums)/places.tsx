import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';

import PlacesScreen from '@/components/places-screen';
import { headerOptions } from '@/components/screen-header';
import { ThemedView } from '@/components/themed-view';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

export default function CollectionPlacesScreen() {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  useEffect(() => {
    void loadCaptureSettings().then(setSettings);
  }, []);

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={headerOptions({ title: 'Places' })} />
      {settings ? <PlacesScreen settings={settings} /> : null}
    </ThemedView>
  );
}
