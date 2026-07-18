import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import AlbumTargetPicker from '@/components/album-target-picker';
import PhotoGrid from '@/components/photo-grid';
import SelectionBar from '@/components/selection-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { setCachedFavorite } from '@/lib/cache/assets';
import { setTrashed } from '@/lib/cache/albums';
import { enqueueAlbumAdd, enqueueFavorite, enqueueTrash } from '@/lib/cache/mutations';
import { addToAlbum, fetchAlbum, setFavorite, trashAsset, type LibraryAsset } from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

type Props = {
  albumId: string;
  albumName?: string;
  onClose: () => void;
};

// AlbumDetail is pushed (as a local overlay, not a router route — see
// AlbumList) when a card is tapped. It loads its own settings the same way
// every other top-level photo surface does, then reuses the shared grid +
// viewer, plus selection mode with the same add-to-album/trash actions as
// the Timeline grid (Task 7).
export default function AlbumDetail({ albumId, albumName, onClose }: Props) {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Selection mode (Task 7): same shape as Timeline in library.tsx — a
  // Set<string> owned here, non-empty means active.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const active = await loadCaptureSettings();
        setSettings(active);
        setAssets(await fetchAlbum(active, albumId));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load this album.');
      } finally {
        setLoading(false);
      }
    })();
  }, [albumId]);

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
  }

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

  const trashSelected = useCallback(async () => {
    const ids = [...selected];
    setSelected(new Set());
    for (const id of ids) {
      setAssets((prev) => prev.filter((a) => a.id !== id));
      await setTrashed(id, true);
      if (settings) {
        try {
          await trashAsset(settings, id);
          continue; // synced online — nothing to queue
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      await enqueueTrash(id);
    }
  }, [selected, settings]);

  return (
    <ThemedView style={styles.fill}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.back}>
          <ThemedText type="smallBold" style={heading}>‹ Albums</ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={heading} numberOfLines={1}>{albumName ?? 'Album'}</ThemedText>
      </View>
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
          onToggleFavorite={(id, next) => void toggleFavorite(id, next)}
          selectedIds={selected}
          onToggleSelect={toggleSelect}
          onLongPressItem={startSelection}
          emptyMessage="No photos in this album yet."
        />
      )}

      {selected.size > 0 && (
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
        onPick={(targetAlbumId) => void addSelectedToAlbum(targetAlbumId)}
        onClose={() => setPickerOpen(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { padding: Spacing.two, gap: Spacing.one },
  back: { alignSelf: 'flex-start', paddingVertical: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, minHeight: 200 },
  msg: { textAlign: 'center' },
});
