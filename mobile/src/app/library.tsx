import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import PhotoViewer from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  fetchLibrary,
  loadCachedRecent,
  saveCachedRecent,
  thumbSource,
  type LibraryAsset,
  type LibraryFilters,
} from '@/lib/library-api';
import { isAuthLost, onAuthLost } from '@/lib/session';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

type Chip = { label: string; filter: LibraryFilters };

const chips: Chip[] = [
  { label: 'All', filter: {} },
  { label: 'Photos', filter: { type: 'image' } },
  { label: 'Videos', filter: { type: 'video' } },
  { label: 'Favorites', filter: { favorite: true } },
];

const columns = 3;
const gap = 2;

export default function LibraryScreen() {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [chip, setChip] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [disconnected, setDisconnected] = useState(isAuthLost());

  useEffect(() => onAuthLost(() => setDisconnected(true)), []);

  const filters = useMemo<LibraryFilters>(() => {
    const q = query.trim();
    return { ...chips[chip].filter, ...(q ? { q } : {}) };
  }, [chip, query]);

  const tile = useMemo(() => {
    const width = Dimensions.get('window').width;
    return (width - gap * (columns - 1)) / columns;
  }, []);

  const load = useCallback(async (active: CaptureSettings, f: LibraryFilters) => {
    setLoading(true);
    setError('');
    try {
      const page = await fetchLibrary(active, f);
      setAssets(page.assets);
      setCursor(page.next_cursor);
      // Cache only the unfiltered recent view for instant next open.
      if (!f.q && !f.type && !f.favorite) void saveCachedRecent(page.assets);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your library.');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const cached = await loadCachedRecent();
      if (cached.length) {
        setAssets(cached);
        setLoading(false);
      }
      const active = await loadCaptureSettings();
      setSettings(active);
      await load(active, { ...chips[0].filter });
    })();
    // Filter changes are driven imperatively from the chip and search handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectChip(i: number) {
    setChip(i);
    const q = query.trim();
    if (settings) void load(settings, { ...chips[i].filter, ...(q ? { q } : {}) });
  }

  function submitSearch() {
    if (settings) void load(settings, filters);
  }

  async function loadMore() {
    if (loadingMore || !cursor || !settings) return;
    setLoadingMore(true);
    try {
      const page = await fetchLibrary(settings, filters, cursor);
      setAssets((prev) => [...prev, ...page.assets]);
      setCursor(page.next_cursor);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <ThemedView style={styles.fill}>
      {disconnected && (
        <View style={styles.banner}>
          <ThemedText type="small" style={styles.bannerText}>
            This device was disconnected. Re-pair it in Settings.
          </ThemedText>
        </View>
      )}
      <View style={styles.header}>
        <TextInput
          placeholder="Search your library"
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={submitSearch}
          style={styles.search}
          returnKeyType="search"
        />
        <View style={styles.chips}>
          {chips.map((c, i) => (
            <Pressable key={c.label} onPress={() => selectChip(i)} style={[styles.chip, i === chip && styles.chipOn]}>
              <ThemedText type="small" style={i === chip ? styles.chipTextOn : undefined}>{c.label}</ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      {error ? (
        <View style={styles.center}>
          <ThemedText type="subtitle">Nothing to show</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.msg} selectable>{error}</ThemedText>
        </View>
      ) : (
        <FlatList
          data={assets}
          keyExtractor={(a) => a.id}
          numColumns={columns}
          columnWrapperStyle={{ gap }}
          contentContainerStyle={{ gap }}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          renderItem={({ item, index }) => {
            const source = settings ? thumbSource(settings, item) : null;
            return (
              <Pressable style={[styles.tile, { width: tile, height: tile }]} onPress={() => setViewerIndex(index)}>
                {source ? (
                  <Image source={source} style={styles.thumb} contentFit="cover" transition={120} cachePolicy="disk" />
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">{item.media_type}</ThemedText>
                )}
                {item.media_type === 'video' && <View style={styles.videoDot} />}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.center}>
                <ThemedText themeColor="textSecondary">No photos match this filter yet.</ThemedText>
              </View>
            )
          }
        />
      )}
      {viewerIndex >= 0 && settings && (
        <PhotoViewer
          assets={assets}
          initialIndex={viewerIndex}
          settings={settings}
          onClose={() => setViewerIndex(-1)}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: { backgroundColor: '#f6d7cf', paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  bannerText: { color: '#7a2b1c' },
  header: { padding: Spacing.two, gap: Spacing.two },
  search: {
    borderColor: '#b8b9be',
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
  },
  chips: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: 999, borderWidth: 1, borderColor: '#b8b9be' },
  chipOn: { backgroundColor: '#24211f', borderColor: '#24211f' },
  chipTextOn: { color: '#fff' },
  tile: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#ded6ca' },
  thumb: { width: '100%', height: '100%' },
  videoDot: { position: 'absolute', bottom: 6, left: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, minHeight: 200 },
  msg: { textAlign: 'center' },
});
