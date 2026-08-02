import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import PhotoGrid from '@/components/photo-grid';
import { ThemedView } from '@/components/themed-view';
import { fetchLibrary, type LibraryAsset } from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

// TagGrid is the body of a single tag's photo grid: the server tag filter fed
// into the shared PhotoGrid (which owns its own viewer).
//
// It is a component rather than a screen because a tag is reachable from two
// tabs -- the Gallery's tag sheet and the Search screen's "Browse tags" -- and
// each tab owns its own stack. A single shared route would have made tapping a
// tag in Search jump the user into the Gallery tab; a thin route in each stack
// pushing this component keeps them where they were.
export default function TagGrid({ tag }: { tag: string }) {
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
      <PhotoGrid
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
});
