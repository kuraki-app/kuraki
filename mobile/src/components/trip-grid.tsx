import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import PhotoGrid from '@/components/photo-grid';
import { ThemedView } from '@/components/themed-view';
import { fetchLibrary, type LibraryAsset } from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

// TripGrid is one trip's photos: the server trip filter fed into the shared
// PhotoGrid (which owns its own viewer).
//
// A component rather than a screen for the same reason TagGrid is one -- a trip
// is reachable from more than one tab, and each tab owns its own stack, so a
// single shared route would jump the user between tabs.
//
// Membership is resolved entirely server-side. The client never adds detected
// and user-added rows together itself, because "which photos are in this trip"
// is the overlay rule, and duplicating it here would be a second place for it
// to drift.
export default function TripGrid({ trip }: { trip: string }) {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadCaptureSettings().then(setSettings);
  }, []);

  const load = useCallback(async () => {
    if (!settings || !trip) return;
    setLoading(true);
    try {
      const page = await fetchLibrary(settings, { trip });
      setAssets(page.assets);
      setCursor(page.next_cursor);
    } finally {
      setLoading(false);
    }
  }, [settings, trip]);

  // Deferred a tick so the first setState inside load doesn't fire
  // synchronously within the effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function loadMore() {
    if (!settings || !cursor || !trip) return;
    const page = await fetchLibrary(settings, { trip }, cursor);
    setAssets((prev) => [...prev, ...page.assets]);
    setCursor(page.next_cursor);
  }

  return (
    <ThemedView style={styles.screen}>
      <PhotoGrid
        assets={assets}
        settings={settings}
        loading={loading}
        onEndReached={() => void loadMore()}
        hasMore={!!cursor}
        emptyMessage="No photos in this trip yet."
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
