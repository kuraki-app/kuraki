import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PhotoGrid from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { addToAlbum, fetchLibrary, type LibraryAsset } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

type Props = {
  visible: boolean;
  albumId: string;
  settings: CaptureSettings | null;
  /** Ids already in the album, so they can be shown as such rather than
   *  offered again as if they were new. */
  existing: Set<string>;
  onClose: () => void;
  /** Called after a successful add, with how many the server actually linked. */
  onAdded: (added: number) => void;
};

/**
 * AlbumAddPicker adds photos to an album from inside the album.
 *
 * Until now the only route into an album was the other direction: select photos
 * in the Gallery, then choose a target album. That works when you are already
 * looking at the photos, and not at all when you are looking at the album and
 * know what is missing from it.
 *
 * The grid is the same PhotoGrid every other surface uses, held in
 * `selectionMode` so a tap always toggles rather than opening the viewer —
 * picking is the only thing to do here.
 *
 * Adding is idempotent server-side (`INSERT OR IGNORE`, owner-scoped), so an
 * asset already in the album costs nothing and the response's `added` count is
 * the truth about what changed. Those assets are still marked, because offering
 * them as if they were new would make the picker lie about the album's contents.
 */
export default function AlbumAddPicker({
  visible,
  albumId,
  settings,
  existing,
  onClose,
  onAdded,
}: Props) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (active: CaptureSettings) => {
    setLoading(true);
    setError('');
    try {
      const page = await fetchLibrary(active, {});
      setAssets(page.assets);
      setCursor(page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your library.');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Deferred a tick so the first setState does not fire synchronously inside
  // the effect, matching the pattern used across the app. Reset on each open so
  // a second visit does not start with the previous visit's ticks.
  useEffect(() => {
    if (!visible || !settings) return;
    const timer = setTimeout(() => {
      setSelected(new Set());
      void load(settings);
    }, 0);
    return () => clearTimeout(timer);
  }, [visible, settings, load]);

  async function loadMore() {
    if (!settings || !cursor) return;
    try {
      const page = await fetchLibrary(settings, {}, cursor);
      setAssets((prev) => [...prev, ...page.assets]);
      setCursor(page.next_cursor);
    } catch {
      /* keep what we have */
    }
  }

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function confirm() {
    if (!settings || selected.size === 0 || saving) return;
    setSaving(true);
    try {
      const added = await addToAlbum(settings, albumId, [...selected]);
      onAdded(added);
      onClose();
    } catch (cause) {
      // Online-only: the album's contents are server state, and queuing a
      // silent add would leave the album looking wrong until the next flush.
      setError(cause instanceof Error ? cause.message : 'Could not add to this album.');
    } finally {
      setSaving(false);
    }
  }

  const count = selected.size;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ThemedView style={styles.fill}>
        <View style={[styles.bar, { paddingTop: insets.top + Spacing.two, borderBottomColor: tokens.border }]}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <ThemedText type="smallBold" themeColor="mutedForeground">
              Cancel
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold" style={heading}>
            {count > 0 ? `${count} selected` : 'Add photos'}
          </ThemedText>
          <Pressable
            onPress={() => void confirm()}
            hitSlop={8}
            disabled={count === 0 || saving}
            accessibilityRole="button">
            <ThemedText
              type="smallBold"
              style={{ color: count === 0 || saving ? tokens.mutedForeground : tokens.primary }}>
              {saving ? 'Adding…' : 'Add'}
            </ThemedText>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.center}>
            <ThemedText themeColor="mutedForeground" style={styles.msg} selectable>
              {error}
            </ThemedText>
          </View>
        ) : (
          <PhotoGrid
            assets={assets}
            settings={settings}
            loading={loading}
            onEndReached={() => void loadMore()}
            selectionMode
            // Everything already in the album reads as selected, so the grid
            // shows the album's current contents in place rather than offering
            // them again. Tapping one is a no-op the server would ignore anyway.
            selectedIds={new Set([...existing, ...selected])}
            onToggleSelect={(id) => {
              if (!existing.has(id)) toggle(id);
            }}
            // The grid paints over the *combined* set, so what comes back
            // includes the album's existing members. They are not part of this
            // screen's selection -- they are already in the album -- so they are
            // filtered back out rather than being re-submitted on confirm.
            onReplaceSelection={(next) =>
              setSelected(new Set([...next].filter((id) => !existing.has(id))))
            }
            emptyMessage="Nothing in your library yet."
          />
        )}
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  msg: { textAlign: 'center' },
});
