import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import PhotoGrid from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { setCachedFavorite } from '@/lib/cache/assets';
import { enqueueFavorite } from '@/lib/cache/mutations';
import { setFavorite, type LibraryAsset, type LibraryPage } from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

type Props = {
  loadPage: (settings: CaptureSettings, cursor?: string) => Promise<LibraryPage>;
  emptyMessage: string;
  removeWhenUnfavorited?: boolean;
};

/** Shared body for collection routes that are server-backed photo grids. */
export default function CollectionGrid({ loadPage, emptyMessage, removeWhenUnfavorited }: Props) {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (active: CaptureSettings, refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const page = await loadPage(active);
      setAssets(page.assets);
      setCursor(page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this collection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadPage]);

  useEffect(() => {
    let live = true;
    void loadCaptureSettings().then((active) => {
      if (!live) return;
      setSettings(active);
      void load(active);
    });
    return () => {
      live = false;
    };
  }, [load]);

  async function loadMore() {
    if (!settings || !cursor) return;
    try {
      const page = await loadPage(settings, cursor);
      setAssets((current) => [...current, ...page.assets]);
      setCursor(page.next_cursor);
    } catch {
      // Keep the collection already on screen; pull-to-refresh can retry.
    }
  }

  async function toggleFavorite(id: string, favorite: boolean) {
    setAssets((current) =>
      removeWhenUnfavorited && !favorite
        ? current.filter((asset) => asset.id !== id)
        : current.map((asset) => (asset.id === id ? { ...asset, favorite } : asset)),
    );
    await setCachedFavorite(id, favorite);
    if (settings) {
      try {
        await setFavorite(settings, id, favorite);
        return;
      } catch {
        // Preserve the optimistic change and replay it after reconnect.
      }
    }
    await enqueueFavorite(id, favorite);
  }

  return (
    <ThemedView style={styles.fill}>
      {error && !assets.length ? (
        <View style={styles.center}>
          <ThemedText type="subtitle">Nothing to show</ThemedText>
          <ThemedText themeColor="mutedForeground" style={styles.message} selectable>{error}</ThemedText>
        </View>
      ) : (
        <PhotoGrid
          assets={assets}
          settings={settings}
          loading={loading}
          refreshing={refreshing}
          onRefresh={() => settings && void load(settings, true)}
          onEndReached={() => void loadMore()}
          hasMore={Boolean(cursor)}
          onToggleFavorite={(id, favorite) => void toggleFavorite(id, favorite)}
          emptyMessage={emptyMessage}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  message: { textAlign: 'center' },
});
