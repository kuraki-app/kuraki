import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, View } from 'react-native';

import PhotoViewer from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { useTokens } from '@/constants/theme';
import { thumbSource, type LibraryAsset } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const columns = 3;
const gap = 2;

type Props = {
  assets: LibraryAsset[];
  settings: CaptureSettings | null;
  loading?: boolean;
  emptyMessage?: string;
  onEndReached?: () => void;
  onToggleFavorite?: (id: string, next: boolean) => void;
  // Selection mode (Task 7): the owning screen holds the Set<string> of
  // selected ids so bulk actions (add to album, trash) can mutate its own
  // asset list. Selection is "active" whenever the set is non-empty — a tap
  // toggles membership instead of opening the viewer, and a long-press on any
  // tile (even outside selection mode) starts it.
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onLongPressItem?: (id: string) => void;
};

// PhotoGrid is the tile grid + full-screen viewer shared by every photo
// surface (Timeline, On this day, Album detail): tile sizing, thumbnail
// rendering, and the PhotoViewer wiring live here exactly once so each
// surface only has to own its own fetch/state.
export default function PhotoGrid({
  assets,
  settings,
  loading,
  emptyMessage,
  onEndReached,
  onToggleFavorite,
  selectedIds,
  onToggleSelect,
  onLongPressItem,
}: Props) {
  const tokens = useTokens();
  const [viewerIndex, setViewerIndex] = useState(-1);
  const selectionActive = !!selectedIds && selectedIds.size > 0;

  const tile = useMemo(() => {
    const width = Dimensions.get('window').width;
    return (width - gap * (columns - 1)) / columns;
  }, []);

  return (
    <>
      <FlatList
        data={assets}
        keyExtractor={(a) => a.id}
        numColumns={columns}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ gap }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        renderItem={({ item, index }) => {
          const source = settings ? thumbSource(settings, item) : null;
          const selected = selectedIds?.has(item.id) ?? false;
          return (
            <Pressable
              style={[styles.tile, { width: tile, height: tile, backgroundColor: tokens.thumb }]}
              onPress={() => (selectionActive ? onToggleSelect?.(item.id) : setViewerIndex(index))}
              onLongPress={() => onLongPressItem?.(item.id)}>
              {source ? (
                <Image source={source} style={styles.thumb} contentFit="cover" transition={120} cachePolicy="disk" />
              ) : (
                <ThemedText type="small" themeColor="mutedForeground">{item.media_type}</ThemedText>
              )}
              {item.media_type === 'video' && <View style={styles.videoDot} />}
              {selected && (
                <View style={[styles.checkBadge, { backgroundColor: tokens.primary, borderColor: tokens.primaryForeground }]}>
                  <ThemedText type="small" themeColor="primaryForeground">✓</ThemedText>
                </View>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.center}>
              <ThemedText themeColor="mutedForeground">{emptyMessage ?? 'Nothing to show yet.'}</ThemedText>
            </View>
          )
        }
      />
      {viewerIndex >= 0 && settings && (
        <PhotoViewer
          assets={assets}
          initialIndex={viewerIndex}
          settings={settings}
          onClose={() => setViewerIndex(-1)}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  videoDot: { position: 'absolute', bottom: 6, left: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, minHeight: 200 },
});
