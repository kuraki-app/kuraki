import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AlbumTargetPicker from '@/components/album-target-picker';
import GalleryHeader from '@/components/gallery-header';
import PhotoGrid from '@/components/photo-grid';
import PlacesScreen from '@/components/places-screen';
import SelectionBar from '@/components/selection-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { readAssets, setCachedFavorite } from '@/lib/cache/assets';
import { enqueueAlbumAdd, enqueueFavorite, enqueueTrash, pendingFavorites } from '@/lib/cache/mutations';
import { setTrashed } from '@/lib/cache/albums';
import { nextConnectionState, probeServer, type ConnectionState } from '@/lib/connection';
import {
  addToAlbum,
  fetchLibrary,
  fetchMemories,
  flushFavorites,
  setFavorite,
  syncChanges,
  trashAsset,
  type LibraryAsset,
  type LibraryFilters,
} from '@/lib/library-api';
import { isAuthLost, onAuthLost } from '@/lib/session';
import { type GalleryView, type GroupBy } from '@/lib/gallery';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

export default function LibraryScreen() {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<GalleryView>('timeline');
  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // On-this-day has no offline cache (it's a date-filtered resurfacing view,
  // not the plain recent one) — its own small state so a failure there can
  // never blank out the Timeline grid or vice versa.
  const [memories, setMemories] = useState<LibraryAsset[]>([]);
  const [memoriesCursor, setMemoriesCursor] = useState<string | undefined>(undefined);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesError, setMemoriesError] = useState('');
  // The three-state connection machine: a 401 revoke is `disconnected` (only a
  // re-pair clears it), a network/address failure is `unreachable` (a probe can
  // recover it). Seed disconnected from the process-wide auth-lost signal.
  const [connection, setConnection] = useState<ConnectionState>(isAuthLost() ? 'disconnected' : 'online');
  const [dismissed, setDismissed] = useState(false);
  const disconnected = connection === 'disconnected';
  // Selection mode (Task 7, Timeline grid only): a Set<string> of selected ids
  // owned here so the bulk actions below can mutate `assets` directly.
  // Selection is "active" whenever the set is non-empty (see PhotoGrid).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

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

  // Drain the delta feed into the SQLite mirror, then repaint the current filter
  // from the reconciled mirror if anything actually changed. Silent on failure —
  // a 401 is already surfaced by the auth-lost machine, and an offline tick just
  // leaves the cursor for the next run. Guarded against concurrent runs so an
  // AppState wake mid-sync doesn't double-apply.
  const syncing = useRef(false);
  const syncAndRefresh = useCallback(
    async (active: CaptureSettings | null, f: LibraryFilters) => {
      if (!active || syncing.current) return;
      syncing.current = true;
      try {
        const { applied, reset } = await syncChanges(active);
        if (applied > 0 || reset) await load(active, f);
      } catch {
        // best-effort; cursor is preserved for the next attempt
      } finally {
        syncing.current = false;
      }
    },
    [load],
  );

  useEffect(() => {
    void (async () => {
      const cached = await readAssets({});
      if (cached.length) {
        setAssets(cached);
        setLoading(false);
      }
      const active = await loadCaptureSettings();
      setSettings(active);
      await load(active, {});
      void probe(active);
      void syncAndRefresh(active, {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On foreground: re-probe reachability (server may have moved on DHCP, or the
  // network came back) and drain the delta feed so edits made elsewhere land.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void probe(settings);
        void syncAndRefresh(settings, {});
      }
    });
    return () => sub.remove();
  }, [probe, settings, syncAndRefresh]);

  // Optimistic favorite: write the cache and UI immediately so the toggle never
  // waits on the network. Only enqueue for later when we're offline or the
  // direct send fails — a successful online write must not leave a queue row
  // behind (it would be replayed and never resolved).
  const toggleFavorite = useCallback(
    async (id: string, next: boolean) => {
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, favorite: next } : a)));
      setMemories((prev) => prev.map((a) => (a.id === id ? { ...a, favorite: next } : a)));
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

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // A long-press on any tile starts selection mode by selecting that tile —
  // selection mode has no separate flag, it's just "the set is non-empty".
  const startSelection = useCallback((id: string) => {
    setSelected((prev) => new Set(prev).add(id));
  }, []);

  function cancelSelection() {
    setSelected(new Set());
  }

  // Add-to-album: same optimistic+queue shape as toggleFavorite above — try
  // the batched online send first and return early on success (nothing to
  // queue), otherwise fall through and queue each id individually so the
  // mutation queue (which is per-asset) can replay it on reconnect.
  const addSelectedToAlbum = useCallback(
    async (albumId: string) => {
      const ids = [...selected];
      setPickerOpen(false);
      setSelected(new Set());
      if (settings && !disconnected) {
        try {
          await addToAlbum(settings, albumId, ids);
          return; // synced online — nothing to queue
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      for (const id of ids) await enqueueAlbumAdd(id, albumId);
    },
    [selected, settings, disconnected],
  );

  // Move to trash: optimistic removal from both visible lists + cache, then
  // the same send-if-online / leave-queued-on-fail shape per id.
  const trashSelected = useCallback(async () => {
    const ids = [...selected];
    setSelected(new Set());
    for (const id of ids) {
      setAssets((prev) => prev.filter((a) => a.id !== id));
      setMemories((prev) => prev.filter((a) => a.id !== id));
      await setTrashed(id, true);
      if (settings && !disconnected) {
        try {
          await trashAsset(settings, id);
          continue; // synced online — nothing to queue
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      await enqueueTrash(id);
    }
  }, [selected, settings, disconnected]);

  async function loadMore() {
    if (loadingMore || !cursor || !settings) return;
    setLoadingMore(true);
    try {
      const page = await fetchLibrary(settings, {}, cursor);
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

  const loadMemories = useCallback(async (active: CaptureSettings) => {
    setMemoriesLoading(true);
    setMemoriesError('');
    try {
      const page = await fetchMemories(active);
      setMemories(page.assets);
      setMemoriesCursor(page.next_cursor);
    } catch (cause) {
      // fetchMemories has no offline cache — it's a date-filtered resurfacing
      // view, not the plain recent one, so there's nothing sane to fall back
      // to. Show a message instead of crashing or displaying stale photos
      // that don't correspond to "on this day".
      setMemories([]);
      setMemoriesError(cause instanceof Error ? cause.message : "Couldn't load memories.");
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  // Reload whenever the segment switches to On-this-day (cheap and keeps the
  // resurfacing view fresh rather than caching a load-once snapshot). Deferred
  // a tick (matching the Backup tab's refresh-on-mount pattern) so the first
  // setState inside loadMemories doesn't fire synchronously within the effect.
  useEffect(() => {
    if (segment !== 'memories' || !settings) return;
    const timer = setTimeout(() => void loadMemories(settings), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, settings]);

  async function loadMoreMemories() {
    if (!settings || !memoriesCursor) return;
    try {
      const page = await fetchMemories(settings, memoriesCursor);
      setMemories((prev) => [...prev, ...page.assets]);
      setMemoriesCursor(page.next_cursor);
    } catch {
      /* keep what we have */
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
            <Pressable onPress={() => router.push('/(app)/settings')} hitSlop={8}>
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
            <Pressable onPress={() => router.push('/(app)/settings')} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: tokens.destructive }}>Edit address</ThemedText>
            </Pressable>
          </View>
        </View>
      )}
      <View style={{ paddingTop: insets.top + Spacing.two }}>
        <GalleryHeader
          view={segment}
          groupBy={groupBy}
          onChangeView={(v) => {
            cancelSelection();
            setSegment(v);
          }}
          onChangeGroupBy={setGroupBy}
        />
      </View>

      {segment === 'timeline' && (
        error ? (
          <View style={styles.center}>
            <ThemedText type="subtitle" style={heading}>Nothing to show</ThemedText>
            <ThemedText themeColor="mutedForeground" style={styles.msg} selectable>{error}</ThemedText>
          </View>
        ) : (
          <PhotoGrid
            assets={assets}
            settings={settings}
            loading={loading}
            onEndReached={() => void loadMore()}
            onToggleFavorite={(id, next) => void toggleFavorite(id, next)}
            selectedIds={selected}
            onToggleSelect={toggleSelect}
            onLongPressItem={startSelection}
            groupBy={groupBy}
            emptyMessage="No photos here yet."
          />
        )
      )}

      {segment === 'memories' && (
        memoriesError ? (
          <View style={styles.center}>
            <ThemedText type="subtitle" style={heading}>Nothing to show</ThemedText>
            <ThemedText themeColor="mutedForeground" style={styles.msg} selectable>{memoriesError}</ThemedText>
          </View>
        ) : (
          <PhotoGrid
            assets={memories}
            settings={settings}
            loading={memoriesLoading}
            onEndReached={() => void loadMoreMemories()}
            onToggleFavorite={(id, next) => void toggleFavorite(id, next)}
            emptyMessage="No memories from this day yet."
          />
        )
      )}

      {segment === 'places' && settings && <PlacesScreen settings={settings} />}

      {segment === 'timeline' && selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          onAddToAlbum={() => setPickerOpen(true)}
          onTrash={() => void trashSelected()}
          onCancel={cancelSelection}
        />
      )}
      <AlbumTargetPicker
        visible={pickerOpen}
        settings={settings}
        onPick={(albumId) => void addSelectedToAlbum(albumId)}
        onClose={() => setPickerOpen(false)}
      />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, minHeight: 200 },
  msg: { textAlign: 'center' },
});
