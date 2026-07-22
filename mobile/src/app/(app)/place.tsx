import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import PhotoGrid from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { fetchLibrary, type LibraryAsset } from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

// PlaceScreen is the grid of a single place's photos, pushed from a Places
// bottom-sheet card. It reuses PhotoGrid (which owns its own viewer) and the
// server's place_city/place_country filter — no new server route.
export default function PlaceScreen() {
  const { place_city, place_country, title } = useLocalSearchParams<{
    place_city: string;
    place_country?: string;
    title?: string;
  }>();
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadCaptureSettings().then(setSettings);
  }, []);

  // Fetch lives in a callback so the effect never calls setState synchronously
  // in its body (react-hooks/set-state-in-effect).
  const load = useCallback(async () => {
    if (!settings || !place_city) return;
    setLoading(true);
    try {
      const page = await fetchLibrary(settings, { place_city, place_country });
      setAssets(page.assets);
      setCursor(page.next_cursor);
    } finally {
      setLoading(false);
    }
  }, [settings, place_city, place_country]);

  // Deferred a tick so the first setState inside load doesn't fire
  // synchronously within the effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function loadMore() {
    if (!settings || !cursor || !place_city) return;
    const page = await fetchLibrary(settings, { place_city, place_country }, cursor);
    setAssets((prev) => [...prev, ...page.assets]);
    setCursor(page.next_cursor);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <ThemedText style={heading}>‹ Back</ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={heading}>
          {title ?? place_city}
        </ThemedText>
        <View style={styles.spacer} />
      </View>
      <PhotoGrid
        assets={assets}
        settings={settings}
        loading={loading}
        onEndReached={() => void loadMore()}
        emptyMessage="No photos from this place yet."
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  spacer: { width: 44 },
});
