import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import AlbumDetail from '@/components/album-detail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import type { CachedAlbum } from '@/lib/cache/albums';
import { createAlbum, fetchAlbums, thumbSource, type LibraryAsset } from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };
const columns = 2;
const gap = 12;

// thumbSource() reads only `id` and `thumbnail_url` off a LibraryAsset; a
// CachedAlbum only carries the cover's id, so this stub lets the cover art
// go through the exact same authenticated-thumb path as the grid instead of
// duplicating the URL/header construction here.
function coverAsset(id: string): LibraryAsset {
  return { id, filename: '', media_type: 'image', favorite: false, thumbnail_url: id };
}

// AlbumList is the Albums segment of the Library tab: a grid of album cards
// with a create action. Tapping a card overlays AlbumDetail via local state
// rather than an expo-router route — consistent with how AlbumPicker (in the
// Backup tab) is toggled in place rather than routed to.
export default function AlbumList() {
  const tokens = useTokens();
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [albums, setAlbums] = useState<CachedAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState('');
  const [openAlbum, setOpenAlbum] = useState<CachedAlbum | null>(null);

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

  useEffect(() => {
    void (async () => {
      const active = await loadCaptureSettings();
      setSettings(active);
      await refresh(active);
    })();
  }, [refresh]);

  function openCreate() {
    setName('');
    setCreateError('');
    setCreating(true);
  }

  function closeCreate() {
    setCreating(false);
    setName('');
    setCreateError('');
  }

  async function submitCreate() {
    const trimmed = name.trim();
    if (!trimmed || !settings) return;
    try {
      await createAlbum(settings, trimmed);
      closeCreate();
      await refresh(settings);
    } catch {
      // createAlbum is online-only: any throw here means offline/unreachable.
      setCreateError('Connect to create an album.');
    }
  }

  if (openAlbum) {
    return <AlbumDetail albumId={openAlbum.id} albumName={openAlbum.name} onClose={() => setOpenAlbum(null)} />;
  }

  return (
    <ThemedView style={styles.fill}>
      <View style={styles.header}>
        <ThemedText type="subtitle" style={heading}>Albums</ThemedText>
        <Pressable style={[styles.addButton, { backgroundColor: tokens.primary }]} onPress={openCreate} hitSlop={8}>
          <ThemedText type="smallBold" themeColor="primaryForeground">＋</ThemedText>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.center}>
          <ThemedText type="subtitle" style={heading}>Nothing to show</ThemedText>
          <ThemedText themeColor="mutedForeground" style={styles.msg} selectable>{error}</ThemedText>
        </View>
      ) : (
        <FlatList
          data={albums}
          keyExtractor={(a) => a.id}
          numColumns={columns}
          columnWrapperStyle={{ gap, paddingHorizontal: Spacing.two }}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => {
            const source = settings && item.cover_asset_id ? thumbSource(settings, coverAsset(item.cover_asset_id)) : null;
            return (
              <Pressable style={styles.card} onPress={() => setOpenAlbum(item)}>
                <View style={[styles.cover, { backgroundColor: tokens.thumb }]}>
                  {source && (
                    <Image source={source} style={styles.coverImage} contentFit="cover" transition={120} cachePolicy="disk" />
                  )}
                </View>
                <ThemedText type="smallBold" numberOfLines={1}>{item.name}</ThemedText>
                <ThemedText type="small" themeColor="mutedForeground">
                  {item.count} item{item.count === 1 ? '' : 's'}
                </ThemedText>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.center}>
                <ThemedText themeColor="mutedForeground">No albums yet. Tap ＋ to create one.</ThemedText>
              </View>
            )
          }
        />
      )}

      <Modal visible={creating} animationType="fade" transparent onRequestClose={closeCreate}>
        <View style={styles.modalBackdrop}>
          <ThemedView type="card" style={styles.modalCard}>
            <ThemedText type="subtitle" style={heading}>New album</ThemedText>
            <TextInput
              placeholder="Album name"
              value={name}
              onChangeText={setName}
              autoFocus
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={() => void submitCreate()}
              style={[styles.input, { borderColor: tokens.input, color: tokens.foreground }]}
            />
            {createError ? (
              <ThemedText type="small" style={{ color: tokens.destructive }} selectable>{createError}</ThemedText>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable style={[styles.ghost, { borderColor: tokens.input }]} onPress={closeCreate}>
                <ThemedText type="smallBold">Cancel</ThemedText>
              </Pressable>
              <Pressable style={[styles.button, { backgroundColor: tokens.primary }]} onPress={() => void submitCreate()}>
                <ThemedText type="smallBold" themeColor="primaryForeground">Create</ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.two,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { paddingBottom: Spacing.four, gap: Spacing.three },
  card: { flex: 1, gap: Spacing.one },
  cover: { width: '100%', aspectRatio: 1, borderRadius: Spacing.two, overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, minHeight: 200 },
  msg: { textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modalCard: { width: '100%', borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  input: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
  },
  modalActions: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'flex-end' },
  ghost: { alignItems: 'center', borderRadius: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderWidth: 1 },
  button: { alignItems: 'center', borderRadius: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
});
