import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, View, type AlertButton } from 'react-native';

import PhotoGrid from '@/components/photo-grid';
import SelectionHeader from '@/components/selection-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { deleteCachedAsset, setTrashed } from '@/lib/cache/albums';
import { enqueuePurge, enqueueRestore } from '@/lib/cache/mutations';
import { fetchTrash, purgeAsset, restoreAsset, type LibraryAsset } from '@/lib/library-api';
import { isAuthLost, onAuthLost } from '@/lib/session';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

// Trash is a manage surface (Task 8), not a Kura photo surface, so it takes
// the VAULT register (Geist Mono, 4px rhythm) rather than the Library tab's
// Kura register — matching the web's Organize grouping. It lives outside the
// `(app)` group (see app/(app)/_layout.tsx: NativeTabs only registers screens
// that have an explicit <NativeTabs.Trigger>, so a bare file dropped in
// alongside it would never be reachable via router.push) — the root layout's
// <Slot/> is a real stack for any top-level route, which is what makes this
// screen push/back correctly from the Settings tab.
const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

export default function TrashScreen() {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  // Seed disconnected from the process-wide auth-lost signal (set on a 401
  // from any endpoint) and keep it live — a recovery/re-pair clears it.
  const [disconnected, setDisconnected] = useState(isAuthLost());
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Selection mode (Task 7 pattern, reused here): a Set<string> of selected
  // ids. Selection is "active" whenever the set is non-empty (see PhotoGrid) —
  // a single long-pressed tile is how a "per item" restore/delete happens.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async (active: CaptureSettings) => {
    setLoading(true);
    setError('');
    try {
      // fetchTrash already falls back to the SQLite `readTrashed` mirror when
      // the server can't be reached, so there's nothing extra to catch here.
      const page = await fetchTrash(active);
      setAssets(page.assets);
      setCursor(page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load trash.');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const active = await loadCaptureSettings();
      setSettings(active);
      await load(active);
    })();
  }, [load]);

  useEffect(() => onAuthLost(() => setDisconnected(isAuthLost())), []);

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

  // Trash groups by date like every other grid, so it gets the same per-group
  // control. It matters more here than anywhere: emptying a month of trash is
  // exactly the bulk act this screen exists for.
  const selectSection = useCallback((ids: string[], allSelected: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  // Restore: optimistic removal from the visible list + cache untrash, then
  // the same send-if-online / leave-queued-on-fail shape as library.tsx's
  // trashSelected (Task 7).
  const restoreSelected = useCallback(async () => {
    const ids = [...selected];
    setSelected(new Set());
    for (const id of ids) {
      setAssets((prev) => prev.filter((a) => a.id !== id));
      await setTrashed(id, false);
      if (settings && !disconnected) {
        try {
          await restoreAsset(settings, id);
          continue; // synced online — nothing to queue
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      await enqueueRestore(id);
    }
  }, [selected, settings, disconnected]);

  // Delete forever: same optimistic+queue shape, but irreversible — confirmed
  // first via a destructive Alert before anything is removed.
  const purgeSelected = useCallback(async () => {
    const ids = [...selected];
    setSelected(new Set());
    for (const id of ids) {
      setAssets((prev) => prev.filter((a) => a.id !== id));
      // A purge is permanent — clear the local mirror unconditionally so the
      // asset can't reappear in the offline Timeline fallback, regardless of
      // whether the online send below succeeds or the mutation gets queued.
      await deleteCachedAsset(id);
      if (settings && !disconnected) {
        try {
          await purgeAsset(settings, id);
          continue; // synced online — nothing to queue
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      await enqueuePurge(id);
    }
  }, [selected, settings, disconnected]);

  function confirmDeleteForever() {
    const count = selected.size;
    const body = `This permanently deletes ${count} item${count === 1 ? '' : 's'}. This cannot be undone.`;
    // Android's Alert ignores `style` entirely and assigns roles by position:
    // the LAST button becomes the emphasized positive action. With the iOS
    // ordering (Cancel, then Delete forever) that made the irreversible purge
    // the default-looking button in plain text, exactly inverting the safety
    // cue iOS gets from `destructive`. Ordering Cancel last puts it in the
    // positive slot on Android, and iOS still styles by `style` regardless of
    // order -- so both platforms end up de-emphasising the destructive path.
    const buttons: AlertButton[] =
      Platform.OS === 'android'
        ? [
            { text: 'Delete forever', style: 'destructive', onPress: () => void purgeSelected() },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete forever', style: 'destructive', onPress: () => void purgeSelected() },
          ];
    Alert.alert('Delete forever?', body, buttons);
  }

  async function loadMore() {
    if (loadingMore || !cursor || !settings) return;
    setLoadingMore(true);
    try {
      const page = await fetchTrash(settings, cursor);
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
      {selected.size > 0 && (
        <SelectionHeader
          count={selected.size}
          onCancel={cancelSelection}
          actions={[
            {
              key: 'restore',
              label: 'Restore',
              icon: 'arrow.uturn.backward',
              onPress: () => void restoreSelected(),
            },
            {
              key: 'purge',
              label: 'Delete forever',
              icon: 'trash.slash',
              destructive: true,
              onPress: confirmDeleteForever,
            },
          ]}
        />
      )}
      {/* Title, top inset and back button all come from the settings stack's
          native header now. What is left is the one line of guidance the
          screen actually needs. */}
      <ThemedText type="small" themeColor="mutedForeground" style={styles.hint}>
        Restore items or delete them forever.
      </ThemedText>
      {error ? (
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
          selectedIds={selected}
          onToggleSelect={toggleSelect}
          onLongPressItem={startSelection}
          onSelectSection={selectSection}
          emptyMessage="Trash is empty."
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hint: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, minHeight: 200 },
  msg: { textAlign: 'center' },
});
