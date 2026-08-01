import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PhotoGrid from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { fetchLibrary, type LibraryAsset } from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';
import { TAB_BAR_HEIGHT } from '@/lib/tab-bar';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

// TagScreen is the grid of a single tag's photos, pushed from the Library tag
// sheet. Reuses PhotoGrid (which owns its viewer) and the server tag filter —
// the exact place.tsx pattern with { tag } instead of { place_city }.
export default function TagScreen() {
  const insets = useSafeAreaInsets();
  const { tag, title } = useLocalSearchParams<{ tag: string; title?: string }>();
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadCaptureSettings().then(setSettings);
  }, []);

  const load = useCallback(async () => {
    if (!settings || !tag) return;
    setLoading(true);
    try {
      const page = await fetchLibrary(settings, { tag });
      setAssets(page.assets);
      setCursor(page.next_cursor);
    } finally {
      setLoading(false);
    }
  }, [settings, tag]);

  // Deferred a tick so the first setState inside load doesn't fire
  // synchronously within the effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function loadMore() {
    if (!settings || !cursor || !tag) return;
    const page = await fetchLibrary(settings, { tag }, cursor);
    setAssets((prev) => [...prev, ...page.assets]);
    setCursor(page.next_cursor);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.bar, { paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <ThemedText style={heading}>‹ Back</ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={heading}>{title ?? 'Tag'}</ThemedText>
        <View style={styles.spacer} />
      </View>
      <PhotoGrid
        bottomInset={TAB_BAR_HEIGHT + insets.bottom}
        assets={assets}
        settings={settings}
        loading={loading}
        onEndReached={() => void loadMore()}
        emptyMessage="No photos with this tag yet."
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
