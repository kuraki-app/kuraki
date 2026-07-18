import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Dimensions, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import PhotoViewer from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { readAssets, setCachedFavorite } from '@/lib/cache/assets';
import { enqueueFavorite, pendingFavorites } from '@/lib/cache/mutations';
import { nextConnectionState, probeServer, type ConnectionState } from '@/lib/connection';
import {
  fetchLibrary,
  flushFavorites,
  setFavorite,
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

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

export default function LibraryScreen() {
  const tokens = useTokens();
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [chip, setChip] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(-1);
  // The three-state connection machine: a 401 revoke is `disconnected` (only a
  // re-pair clears it), a network/address failure is `unreachable` (a probe can
  // recover it). Seed disconnected from the process-wide auth-lost signal.
  const [connection, setConnection] = useState<ConnectionState>(isAuthLost() ? 'disconnected' : 'online');
  const [dismissed, setDismissed] = useState(false);
  const disconnected = connection === 'disconnected';

  // probe feeds a reachability check through the machine. It can never clear a
  // revoke (nextConnectionState guards that), only move online<->unreachable.
  const probe = useCallback(async (active: CaptureSettings | null) => {
    if (!active) return;
    const result = await probeServer(active.baseURL);
    setConnection((c) => nextConnectionState(c, result === 'ok' ? 'probe-ok' : 'probe-unreachable'));
  }, []);

  // An auth-lost notification reflects the current signal: a report drives us to
  // `disconnected`; a recovery (clearAuthLost after re-pair) maps to `reconnected`
  // and drains the offline favorite queue over the freshly reconnected link.
  useEffect(
    () =>
      onAuthLost(() => {
        if (isAuthLost()) {
          setConnection((c) => nextConnectionState(c, 'auth-lost'));
        } else {
          setConnection((c) => nextConnectionState(c, 'reconnected'));
          if (settings) void flushFavorites(settings);
        }
      }),
    [settings],
  );

  // Re-probe whenever the app returns to the foreground — the server may have
  // moved (DHCP) or the network may have come back while we were backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void probe(settings);
    });
    return () => sub.remove();
  }, [probe, settings]);

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
      // Overlay any un-flushed optimistic favorites so the server's stale value
      // (upserted into the cache by fetchLibrary) can't visually revert them.
      const pend = await pendingFavorites();
      const merged = pend.size
        ? page.assets.map((a) => (pend.has(a.id) ? { ...a, favorite: pend.get(a.id)! } : a))
        : page.assets;
      setAssets(merged);
      setCursor(page.next_cursor);
      // fetchLibrary already refreshed the offline cache on an unfiltered page.
    } catch (cause) {
      // Offline or the server is unreachable: fall back to whatever this filter
      // last saw in the SQLite cache so the grid still shows something.
      const cachedFallback = await readAssets(f);
      if (cachedFallback.length) {
        setAssets(cachedFallback);
        setError('');
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not load your library.');
        setAssets([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const cached = await readAssets({});
      if (cached.length) {
        setAssets(cached);
        setLoading(false);
      }
      const active = await loadCaptureSettings();
      setSettings(active);
      await load(active, { ...chips[0].filter });
      void probe(active);
    })();
    // Filter changes are driven imperatively from the chip and search handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optimistic favorite: write the cache and UI immediately so the toggle never
  // waits on the network. Only enqueue for later when we're offline or the
  // direct send fails — a successful online write must not leave a queue row
  // behind (it would be replayed and never resolved).
  const toggleFavorite = useCallback(
    async (id: string, next: boolean) => {
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, favorite: next } : a)));
      await setCachedFavorite(id, next);
      if (settings && !disconnected) {
        try {
          await setFavorite(settings, id, next);
          return; // synced online — nothing to queue
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      await enqueueFavorite(id, next);
    },
    [settings, disconnected],
  );

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
      const pend = await pendingFavorites();
      const merged = pend.size
        ? page.assets.map((a) => (pend.has(a.id) ? { ...a, favorite: pend.get(a.id)! } : a))
        : page.assets;
      setAssets((prev) => [...prev, ...merged]);
      setCursor(page.next_cursor);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <ThemedView style={styles.fill}>
      {disconnected && !dismissed && (
        <View style={[styles.banner, { backgroundColor: tokens.destructiveBg }]}>
          <ThemedText type="small" style={[styles.bannerText, { color: tokens.destructive }]}>
            This device was disconnected. Re-pair it in Settings.
          </ThemedText>
          <View style={styles.bannerActions}>
            <Pressable onPress={() => router.push('/(app)/explore')} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: tokens.destructive }}>Reconnect</ThemedText>
            </Pressable>
            <Pressable onPress={() => setDismissed(true)} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: tokens.destructive }}>✕</ThemedText>
            </Pressable>
          </View>
        </View>
      )}
      {connection === 'unreachable' && (
        // Distinct from the 401 banner: the token is still valid, the server is
        // just unreachable (e.g. it moved addresses). Not dismissible — it stays
        // until a probe recovers or the user fixes the address.
        <View style={[styles.banner, { backgroundColor: tokens.destructiveBg }]}>
          <ThemedText type="small" style={[styles.bannerText, { color: tokens.destructive }]}>
            Can’t reach your server.
          </ThemedText>
          <View style={styles.bannerActions}>
            <Pressable onPress={() => void probe(settings)} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: tokens.destructive }}>Retry</ThemedText>
            </Pressable>
            <Pressable onPress={() => router.push('/(app)/explore')} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: tokens.destructive }}>Edit address</ThemedText>
            </Pressable>
          </View>
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
          style={[styles.search, { borderColor: tokens.input }]}
          returnKeyType="search"
        />
        <View style={styles.chips}>
          {chips.map((c, i) => (
            <Pressable
              key={c.label}
              onPress={() => selectChip(i)}
              style={[
                styles.chip,
                { borderColor: tokens.input },
                i === chip && { backgroundColor: tokens.primary, borderColor: tokens.primary },
              ]}>
              <ThemedText
                type="small"
                themeColor={i === chip ? 'primaryForeground' : undefined}
                style={heading}>
                {c.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      {error ? (
        <View style={styles.center}>
          <ThemedText type="subtitle" style={heading}>Nothing to show</ThemedText>
          <ThemedText themeColor="mutedForeground" style={styles.msg} selectable>{error}</ThemedText>
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
              <Pressable
                style={[styles.tile, { width: tile, height: tile, backgroundColor: tokens.thumb }]}
                onPress={() => setViewerIndex(index)}>
                {source ? (
                  <Image source={source} style={styles.thumb} contentFit="cover" transition={120} cachePolicy="disk" />
                ) : (
                  <ThemedText type="small" themeColor="mutedForeground">{item.media_type}</ThemedText>
                )}
                {item.media_type === 'video' && <View style={styles.videoDot} />}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.center}>
                <ThemedText themeColor="mutedForeground">No photos match this filter yet.</ThemedText>
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
          onToggleFavorite={(id, next) => void toggleFavorite(id, next)}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  bannerText: { flex: 1 },
  bannerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  header: { padding: Spacing.two, gap: Spacing.two },
  search: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
  },
  chips: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: 999, borderWidth: 1 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  videoDot: { position: 'absolute', bottom: 6, left: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, minHeight: 200 },
  msg: { textAlign: 'center' },
});
