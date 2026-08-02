import BottomSheet, { BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

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
  return { id, filename: '', media_type: 'image', favorite: false, web_viewable: false, thumbnail_url: id };
}

type Props = {
  /**
   * Whether the create-album sheet is open. Owned by the screen rather than
   * here, because the button that opens it lives in the native header.
   */
  creating: boolean;
  onCreatingChange: (next: boolean) => void;
};

// AlbumList is the grid of album cards in the Albums tab. Tapping a card pushes
// the album's own route: it used to swap AlbumDetail in through local state,
// which looked like navigation but was not -- no back button, no back gesture,
// and Android's hardware back left the tab entirely instead of closing the
// album.
export default function AlbumList({ creating, onCreatingChange }: Props) {
  const tokens = useTokens();
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [albums, setAlbums] = useState<CachedAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState('');
  const snapPoints = useMemo(() => ['34%'], []);

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

  function closeCreate() {
    onCreatingChange(false);
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

  return (
    <ThemedView style={styles.fill}>
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
          contentInsetAdjustmentBehavior="automatic"
          renderItem={({ item }) => {
            const source = settings && item.cover_asset_id ? thumbSource(settings, coverAsset(item.cover_asset_id)) : null;
            return (
              <Pressable
                style={styles.card}
                onPress={() =>
                  router.push({
                    pathname: '/(app)/(albums)/album',
                    params: { id: item.id, name: item.name },
                  })
                }>
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

      {/*
        A sheet, not a centred transparent Modal. Naming a new album is the same
        small dismissible task as picking a tag, and every other one of those in
        this app is a bottom sheet -- so this gets the same handle, the same
        pan-down-to-close and the same keyboard behaviour, instead of a dialog
        whose only exit was its own Cancel button.
      */}
      {creating && (
        <BottomSheet
          index={0}
          snapPoints={snapPoints}
          onClose={closeCreate}
          enablePanDownToClose
          backgroundStyle={{ backgroundColor: tokens.card }}
          handleIndicatorStyle={{ backgroundColor: tokens.mutedForeground }}>
          <BottomSheetView style={styles.sheet}>
            <ThemedText type="subtitle" style={heading}>New album</ThemedText>
            <BottomSheetTextInput
              placeholder="Album name"
              placeholderTextColor={tokens.textFaint}
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
            <Pressable
              style={[styles.button, { backgroundColor: tokens.primary }, !name.trim() && styles.disabled]}
              disabled={!name.trim()}
              onPress={() => void submitCreate()}>
              <ThemedText type="smallBold" themeColor="primaryForeground">Create</ThemedText>
            </Pressable>
          </BottomSheetView>
        </BottomSheet>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grid: { gap: Spacing.three, paddingBottom: Spacing.four },
  card: { flex: 1, gap: Spacing.one },
  cover: { width: '100%', aspectRatio: 1, borderRadius: Spacing.two, overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, minHeight: 200 },
  msg: { textAlign: 'center' },
  sheet: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two },
  input: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
  },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three },
  disabled: { opacity: 0.5 },
});
