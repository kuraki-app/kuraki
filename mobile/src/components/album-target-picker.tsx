import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import Dialog from '@/components/dialog';
import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import type { CachedAlbum } from '@/lib/cache/albums';
import { createAlbum, fetchAlbums } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

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
// A Dialog. As a bottom sheet this was the clearest casualty of sheets being
// laid out inside the screen: the native tab bar covered the album list's last
// rows and the "Create & add" button, so selecting photos and choosing where to
// put them ended at a control that could be seen but not pressed.
export default function AlbumTargetPicker({ visible, settings, onPick, onClose }: Props) {
  const tokens = useTokens();
  const [albums, setAlbums] = useState<CachedAlbum[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

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

  return (
    <Dialog visible={visible} title="Add to album" register="kura" onClose={onClose}>
      {error ? (
        <ThemedText type="small" style={[styles.pad, { color: tokens.destructive }]} selectable>
          {error}
        </ThemedText>
      ) : null}
      <View style={styles.createRow}>
        <TextInput
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
      <FlatList
        data={albums}
        keyExtractor={(a) => a.id}
        keyboardShouldPersistTaps="handled"
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
    </Dialog>
  );
}

const styles = StyleSheet.create({
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
