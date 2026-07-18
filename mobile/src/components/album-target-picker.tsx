import { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
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
// fetchAlbums/createAlbum calls AlbumList uses to render the Albums segment.
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
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ThemedView type="card" style={styles.card}>
          <ThemedText type="subtitle" style={heading}>Add to album</ThemedText>
          {error ? (
            <ThemedText type="small" style={{ color: tokens.destructive }} selectable>{error}</ThemedText>
          ) : null}
          <FlatList
            data={albums}
            keyExtractor={(a) => a.id}
            style={styles.list}
            renderItem={({ item }) => (
              <Pressable style={[styles.row, { borderBottomColor: tokens.input }]} onPress={() => onPick(item.id)}>
                <ThemedText selectable>{item.name}</ThemedText>
                <ThemedText type="small" themeColor="mutedForeground">
                  {item.count} item{item.count === 1 ? '' : 's'}
                </ThemedText>
              </Pressable>
            )}
            ListEmptyComponent={
              loading ? null : <ThemedText themeColor="mutedForeground">No albums yet. Create one below.</ThemedText>
            }
          />
          <View style={styles.createRow}>
            <TextInput
              placeholder="New album name"
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
          <Pressable style={[styles.ghost, { borderColor: tokens.input }]} onPress={onClose}>
            <ThemedText type="smallBold">Cancel</ThemedText>
          </Pressable>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: { width: '100%', maxHeight: '80%', borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  list: { flexGrow: 0 },
  row: { paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, gap: Spacing.half },
  createRow: { gap: Spacing.two },
  input: { borderRadius: Spacing.two, borderWidth: 1, fontSize: 16, minHeight: 44, paddingHorizontal: Spacing.two },
  button: { alignItems: 'center', borderRadius: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  disabled: { opacity: 0.5 },
  ghost: {
    alignItems: 'center',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
  },
});
