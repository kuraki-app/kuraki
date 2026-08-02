import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import AlbumAddPicker from '@/components/album-add-picker';
import AlbumTargetPicker from '@/components/album-target-picker';
import PhotoGrid from '@/components/photo-grid';
import SelectionBar from '@/components/selection-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { registerStyle } from '@/design/registers';
import { setCachedFavorite } from '@/lib/cache/assets';
import { setTrashed } from '@/lib/cache/albums';
import { enqueueAlbumAdd, enqueueFavorite, enqueueTrash } from '@/lib/cache/mutations';
import {
  addToAlbum,
  fetchAlbum,
  removeFromAlbum,
  setFavorite,
  trashAsset,
  type LibraryAsset,
} from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

type Props = {
  albumId: string;
  /** Opened from the route's "Add photos" toolbar button. */
  adding: boolean;
  onAddingChange: (next: boolean) => void;
};

// AlbumDetail is the body of the album route. It loads its own settings the
// same way every other top-level photo surface does, then reuses the shared
// grid + viewer, plus selection mode with the same add-to-album/trash actions
// as the Timeline grid (Task 7). The title and the back affordance belong to
// the route's native header, not to this component.
export default function AlbumDetail({ albumId, adding, onAddingChange }: Props) {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Selection: a Set<string> owned here. `selectionMode` is separate from
  // "the set is non-empty" so Select can be entered before anything is chosen.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [cursor, setCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);

  const reload = useCallback(
    async (active: CaptureSettings) => {
      setLoading(true);
      setError('');
      try {
        const page = await fetchAlbum(active, albumId);
        setAssets(page.assets);
        setCursor(page.next_cursor);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load this album.');
      } finally {
        setLoading(false);
      }
    },
    [albumId],
  );

  // An album bigger than one page used to stop at the first: fetchAlbum
  // discarded the cursor, so there was nothing to continue from.
  const loadMore = useCallback(async () => {
    if (!settings || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchAlbum(settings, albumId, cursor);
      setAssets((prev) => [...prev, ...page.assets]);
      setCursor(page.next_cursor);
    } catch {
      /* keep what we have; the next scroll retries */
    } finally {
      setLoadingMore(false);
    }
  }, [settings, albumId, cursor, loadingMore]);

  useEffect(() => {
    void (async () => {
      const active = await loadCaptureSettings();
      setSettings(active);
      await reload(active);
    })();
  }, [albumId, reload]);

  // Task 6 gap fix: the grid here never got onToggleFavorite wired, so the
  // viewer showed no favorite button inside an album. Same optimistic+queue
  // shape as library.tsx's toggleFavorite — this screen has no connection
  // state machine, so "online" is simply "settings are loaded".
  const toggleFavorite = useCallback(
    async (id: string, next: boolean) => {
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, favorite: next } : a)));
      await setCachedFavorite(id, next);
      if (settings) {
        try {
          await setFavorite(settings, id, next);
          return; // synced online — nothing to queue
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      await enqueueFavorite(id, next);
    },
    [settings],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const startSelection = useCallback((id: string) => {
    setSelected((prev) => new Set(prev).add(id));
  }, []);

  function cancelSelection() {
    setSelected(new Set());
    setSelectionMode(false);
  }

  // Select all flips to clear once everything is chosen, so one control does
  // both and the bar does not grow a fifth action.
  function selectAll() {
    setSelected((prev) => (prev.size >= assets.length ? new Set() : new Set(assets.map((a) => a.id))));
  }

  /**
   * Remove from *this* album, which only unlinks: the photos stay in the
   * library and in every other album. That is why it is a separate action from
   * Trash rather than a variant of it, and why it is not queued offline —
   * album membership is server state with no local mirror to reconcile.
   */
  const removeSelected = useCallback(async () => {
    if (!settings) return;
    const ids = [...selected];
    if (ids.length === 0) return;
    cancelSelection();
    setAssets((prev) => prev.filter((a) => !ids.includes(a.id)));
    try {
      await removeFromAlbum(settings, albumId, ids);
    } catch (cause) {
      // Put them back: the album is the server's list, and a failed unlink
      // that left them hidden would misreport what the album contains.
      setError(cause instanceof Error ? cause.message : 'Could not remove from this album.');
      await reload(settings);
    }
  }, [selected, settings, albumId, reload]);

  const addSelectedToAlbum = useCallback(
    async (targetAlbumId: string) => {
      const ids = [...selected];
      setPickerOpen(false);
      setSelected(new Set());
      if (settings) {
        try {
          await addToAlbum(settings, targetAlbumId, ids);
          return; // synced online — nothing to queue
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      for (const id of ids) await enqueueAlbumAdd(id, targetAlbumId);
    },
    [selected, settings],
  );

  // Per-asset, so the viewer's delete button and the selection bar's bulk
  // action run the same code rather than two copies that can drift.
  const trashOne = useCallback(
    async (id: string) => {
      setAssets((prev) => prev.filter((a) => a.id !== id));
      await setTrashed(id, true);
      if (settings) {
        try {
          await trashAsset(settings, id);
          return; // synced online — nothing to queue
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      await enqueueTrash(id);
    },
    [settings],
  );

  const trashSelected = useCallback(async () => {
    const ids = [...selected];
    setSelected(new Set());
    for (const id of ids) await trashOne(id);
  }, [selected, trashOne]);

  return (
    <ThemedView style={styles.fill}>
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
          onToggleFavorite={(id, next) => void toggleFavorite(id, next)}
          onDelete={(id) => void trashOne(id)}
          selectedIds={selected}
          selectionMode={selectionMode}
          onToggleSelect={toggleSelect}
          onLongPressItem={(id) => {
            setSelectionMode(true);
            startSelection(id);
          }}
          emptyMessage="No photos in this album yet."
        />
      )}

      {(selectionMode || selected.size > 0) && (
        <SelectionBar
          count={selected.size}
          total={assets.length}
          onSelectAll={selectAll}
          onAddToAlbum={() => setPickerOpen(true)}
          onRemoveFromAlbum={() => void removeSelected()}
          onTrash={() => void trashSelected()}
          onCancel={cancelSelection}
        />
      )}
      <AlbumTargetPicker
        visible={pickerOpen}
        settings={settings}
        onPick={(targetAlbumId) => void addSelectedToAlbum(targetAlbumId)}
        onClose={() => setPickerOpen(false)}
      />
      <AlbumAddPicker
        visible={adding}
        albumId={albumId}
        settings={settings}
        existing={new Set(assets.map((a) => a.id))}
        onClose={() => onAddingChange(false)}
        onAdded={() => {
          if (settings) void reload(settings);
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, minHeight: 200 },
  msg: { textAlign: 'center' },
});
