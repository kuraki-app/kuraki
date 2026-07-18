import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, View, type ViewToken } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { fullImageSource, videoSource, type LibraryAsset } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

type Props = {
  assets: LibraryAsset[];
  initialIndex: number;
  settings: CaptureSettings;
  onClose: () => void;
  onToggleFavorite?: (id: string, next: boolean) => void;
};

// PhotoViewer is a full-screen, swipeable pager over the library grid. Images
// use the best browser-safe source; videos play the original through
// expo-video. Only the active video plays, so scrolling does not stack players.
export default function PhotoViewer({ assets, initialIndex, settings, onClose, onToggleFavorite }: Props) {
  const width = Dimensions.get('window').width;
  const [active, setActive] = useState(initialIndex);
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActive(first.index);
  }, []);

  const current = assets[active];

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.fill}>
        <FlatList
          data={assets}
          keyExtractor={(a) => a.id}
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          renderItem={({ item, index }) => (
            <ViewerCell asset={item} settings={settings} width={width} active={index === active} />
          )}
        />
        <View style={styles.top} pointerEvents="box-none">
          <Pressable style={styles.close} onPress={onClose} hitSlop={12}>
            <ThemedText type="smallBold" style={styles.closeText}>Close</ThemedText>
          </Pressable>
          {current && (
            <View style={styles.caption} pointerEvents="none">
              <ThemedText style={styles.captionText} numberOfLines={1}>{current.filename}</ThemedText>
              {current.taken_at ? (
                <ThemedText style={styles.captionSub}>{current.taken_at.slice(0, 10)}</ThemedText>
              ) : null}
            </View>
          )}
          {current && onToggleFavorite && (
            <Pressable
              style={styles.favorite}
              onPress={() => onToggleFavorite(current.id, !current.favorite)}
              hitSlop={12}>
              <ThemedText type="smallBold" style={styles.closeText}>
                {current.favorite ? '♥ Favorited' : '♡ Favorite'}
              </ThemedText>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ViewerCell({
  asset,
  settings,
  width,
  active,
}: {
  asset: LibraryAsset;
  settings: CaptureSettings;
  width: number;
  active: boolean;
}) {
  if (asset.media_type === 'video') {
    return <VideoCell asset={asset} settings={settings} width={width} active={active} />;
  }
  const source = fullImageSource(settings, asset);
  return (
    <View style={[styles.cell, { width }]}>
      {source ? (
        <Image source={source} style={styles.media} contentFit="contain" transition={150} cachePolicy="disk" />
      ) : (
        <ThemedText style={styles.captionText}>Preview unavailable</ThemedText>
      )}
    </View>
  );
}

function VideoCell({
  asset,
  settings,
  width,
  active,
}: {
  asset: LibraryAsset;
  settings: CaptureSettings;
  width: number;
  active: boolean;
}) {
  const src = videoSource(settings, asset);
  const player = useVideoPlayer(src ? { uri: src.uri, headers: src.headers } : null, (p) => {
    p.loop = false;
  });
  // Play only while this cell is the visible page.
  if (active) player.play();
  else player.pause();

  return (
    <View style={[styles.cell, { width }]}>
      <VideoView player={player} style={styles.media} contentFit="contain" nativeControls />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  media: { width: '100%', height: '100%' },
  top: { position: 'absolute', top: 48, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  close: { backgroundColor: '#00000088', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  closeText: { color: '#fff' },
  favorite: { backgroundColor: '#00000088', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  caption: { flex: 1 },
  captionText: { color: '#fff' },
  captionSub: { color: '#cfcfcf', fontSize: 12 },
});
