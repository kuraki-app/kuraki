import BottomSheet, { BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import type { CachedAlbum } from '@/lib/cache/albums';
import { createAlbum, fetchAlbums } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

type Props = {
  visible: boolean;
  settings: CaptureSettings | null;
  onPick: (albumId: string) => void;
  onClose: () => void;
};

// AlbumTargetPicker lets the selection bar's "Add to album" action choose (or
// create) the server album selected photos get added to. This is distinct
// from AlbumPicker (Backup tab), which picks *device* albums to source
// backups from — this one picks a *server* album, via the same
// fetchAlbums/createAlbum calls AlbumList uses to render the Albums tab.
//
// A bottom sheet, matching every other pick-one-thing surface in the app. It
// was a centred transparent Modal with its own hand-drawn Cancel button, which
// meant a list of albums capped at 80% of the screen in a floating card that
// could not be dragged, flicked away or resized.
export default function AlbumTargetPicker({ visible, settings, onPick, onClose }: Props) {
  const tokens = useTokens();
  const [albums, setAlbums] = useState<CachedAlbum[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const snapPoints = useMemo(() => ['50%', '85%'], []);

  const refresh = useCallback(async (active: CaptureSettings) => {
    setLoading(true);
    setError('');
    try {
      setAlbums(await fetchAlbums(active));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load albums.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Deferred a tick (matching the Library tab's On-this-day pattern) so the
  // first setState inside refresh doesn't fire synchronously within the effect.
  useEffect(() => {
    if (!visible || !settings) return;
    const timer = setTimeout(() => void refresh(settings), 0);
    return () => clearTimeout(timer);
  }, [visible, settings, refresh]);

  async function submitCreate() {
    const trimmed = name.trim();
    if (!trimmed || !settings) return;
    setCreating(true);
    setError('');
    try {
      const album = await createAlbum(settings, trimmed);
      setName('');
      onPick(album.id);
    } catch {
      // createAlbum is online-only: any throw here means offline/unreachable.
      setError('Connect to create an album.');
    } finally {
      setCreating(false);
    }
  }

  if (!visible) return null;

  return (
    <BottomSheet
      index={0}
      snapPoints={snapPoints}
      onClose={onClose}
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: tokens.card }}
      handleIndicatorStyle={{ backgroundColor: tokens.mutedForeground }}>
      <View style={styles.header}>
        <ThemedText type="subtitle" style={heading}>Add to album</ThemedText>
      </View>
      {error ? (
        <ThemedText type="small" style={[styles.pad, { color: tokens.destructive }]} selectable>
          {error}
        </ThemedText>
      ) : null}
      <View style={styles.createRow}>
        <BottomSheetTextInput
          placeholder="New album name"
          placeholderTextColor={tokens.textFaint}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => void submitCreate()}
          style={[styles.input, { borderColor: tokens.input, color: tokens.foreground }]}
        />
        <Pressable
          style={[styles.button, { backgroundColor: tokens.primary }, (!name.trim() || creating) && styles.disabled]}
          disabled={!name.trim() || creating}
          onPress={() => void submitCreate()}>
          <ThemedText type="smallBold" themeColor="primaryForeground">Create &amp; add</ThemedText>
        </Pressable>
      </View>
      <BottomSheetFlatList
        data={albums}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <Pressable style={[styles.row, { borderBottomColor: tokens.border }]} onPress={() => onPick(item.id)}>
            <ThemedText>{item.name}</ThemedText>
            <ThemedText type="small" themeColor="mutedForeground">
              {item.count} item{item.count === 1 ? '' : 's'}
            </ThemedText>
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? null : (
            <ThemedText themeColor="mutedForeground" style={styles.pad}>
              No albums yet. Create one above.
            </ThemedText>
          )
        }
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.one },
  pad: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.half },
  createRow: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  input: { borderRadius: Spacing.two, borderWidth: 1, fontSize: 16, minHeight: 44, paddingHorizontal: Spacing.two },
  button: { alignItems: 'center', borderRadius: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  disabled: { opacity: 0.5 },
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.half,
  },
});
