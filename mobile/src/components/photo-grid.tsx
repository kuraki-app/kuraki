import { Image } from 'expo-image';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  SectionList,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import PhotoViewer from '@/components/photo-viewer';
import ScrollScrubber from '@/components/scroll-scrubber';
import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { usePrefs } from '@/hooks/use-prefs';
import { groupAssets, type PhotoRow } from '@/lib/gallery';
import { thumbSource, type LibraryAsset } from '@/lib/library-api';
import { offsetForProgress, progressForOffset } from '@/lib/scrubber';
import type { CaptureSettings } from '@/lib/settings';

type Props = {
  assets: LibraryAsset[];
  settings: CaptureSettings | null;
  loading?: boolean;
  emptyMessage?: string;
  onEndReached?: () => void;
  onToggleFavorite?: (id: string, next: boolean) => void;
  // Selection mode: the owning screen holds the Set<string> of selected ids so
  // bulk actions (add to album, trash) can mutate its own asset list.
  // Selection is "active" whenever the set is non-empty — a tap toggles
  // membership instead of opening the viewer, and a long-press on any tile
  // (even outside selection mode) starts it.
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onLongPressItem?: (id: string) => void;
};

// PhotoGrid is the tile grid + full-screen viewer shared by every photo surface
// (Timeline, On this day, Album detail, Search): tile sizing, thumbnail
// rendering, date grouping, the scrubber and the PhotoViewer wiring live here
// exactly once so each surface only owns its own fetch/state.
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
  // Layout and grouping are preferences, read here rather than threaded through
  // every caller: there is one grid, and Settings > Photo Grid is its one
  // source of truth.
  const { gridColumns: columns, gridGap: gap, groupBy, showGroupHeaders } = usePrefs();
  const [viewerIndex, setViewerIndex] = useState(-1);
  const selectionActive = !!selectedIds && selectedIds.size > 0;

  const listRef = useRef<SectionList<PhotoRow>>(null);
  const metrics = useRef({ offsetY: 0, contentHeight: 0, layoutHeight: 0 });
  const [progress, setProgress] = useState(0);
  const [trackHeight, setTrackHeight] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [label, setLabel] = useState('');
  const fade = useMemo(() => new Animated.Value(0), []);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sections = useMemo(() => groupAssets(assets, groupBy, columns), [assets, groupBy, columns]);

  // A flat, index-aligned view of the same assets, so the viewer can open at
  // the right photo and page through the whole library rather than one group.
  const flat = useMemo(() => sections.flatMap((s) => s.data.flat()), [sections]);

  const tile = useMemo(() => {
    const width = Dimensions.get('window').width;
    return (width - gap * (columns - 1)) / columns;
  }, [columns, gap]);

  // Fade in on movement, out after a pause. `hold` keeps it pinned while a
  // finger is down so the thumb cannot vanish mid-drag.
  const showScrubber = useCallback(
    (hold = false) => {
      Animated.timing(fade, { toValue: 1, duration: 120, useNativeDriver: true }).start();
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (hold) return;
      idleTimer.current = setTimeout(() => {
        Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      }, 1200);
    },
    [fade],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      metrics.current = {
        offsetY: contentOffset.y,
        contentHeight: contentSize.height,
        layoutHeight: layoutMeasurement.height,
      };
      if (!scrubbing) {
        setProgress(progressForOffset(contentOffset.y, contentSize.height, layoutMeasurement.height));
      }
      showScrubber();
    },
    [scrubbing, showScrubber],
  );

  const onScrubTo = useCallback((next: number) => {
    setProgress(next);
    const { contentHeight, layoutHeight } = metrics.current;
    listRef.current?.getScrollResponder?.()?.scrollTo({
      y: offsetForProgress(next, contentHeight, layoutHeight),
      animated: false,
    });
  }, []);

  // The bubble names the group the top of the viewport is in. Taken from the
  // topmost viewable row rather than computed from the offset, so it stays
  // right regardless of how tall each group happens to be.
  // Identity must stay stable: SectionList rejects a changing
  // onViewableItemsChanged at runtime.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { section?: { title?: string } }[] }) => {
      const title = viewableItems.find((v) => v.section?.title)?.section?.title;
      if (title) setLabel(title);
    },
    [],
  );

  const scrubbable = groupBy !== 'off' && assets.length > columns * 12;

  if (!loading && assets.length === 0) {
    return (
      <View style={styles.center}>
        <ThemedText themeColor="mutedForeground">{emptyMessage ?? 'Nothing to show yet.'}</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.fill} onLayout={(e) => setTrackHeight(e.nativeEvent.layout.height)}>
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(row, index) => row[0]?.id ?? String(index)}
        // The native tab bar and the home indicator are both accounted for by
        // the OS when this is 'automatic'; hard-coding a bottom pad instead
        // double-counts on one platform or the other.
        contentInsetAdjustmentBehavior="automatic"
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewableItemsChanged}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) =>
          showGroupHeaders && section.title ? (
            <ThemedText type="smallBold" style={styles.sectionHeader}>
              {section.title}
            </ThemedText>
          ) : null
        }
        renderItem={({ item: row }) => (
          <View style={[styles.row, { gap, marginBottom: gap }]}>
            {row.map((item) => {
              const source = settings ? thumbSource(settings, item) : null;
              const selected = selectedIds?.has(item.id) ?? false;
              return (
                <Pressable
                  key={item.id}
                  style={[styles.tile, { width: tile, height: tile, backgroundColor: tokens.thumb }]}
                  onPress={() =>
                    selectionActive
                      ? onToggleSelect?.(item.id)
                      : setViewerIndex(flat.findIndex((a) => a.id === item.id))
                  }
                  onLongPress={() => onLongPressItem?.(item.id)}>
                  {source ? (
                    <Image
                      source={source}
                      style={styles.thumb}
                      contentFit="cover"
                      transition={120}
                      cachePolicy="disk"
                    />
                  ) : (
                    <ThemedText type="small" themeColor="mutedForeground">
                      {item.media_type}
                    </ThemedText>
                  )}
                  {item.media_type === 'video' && <View style={styles.videoDot} />}
                  {selected && (
                    <View
                      style={[
                        styles.checkBadge,
                        { backgroundColor: tokens.primary, borderColor: tokens.primaryForeground },
                      ]}>
                      <ThemedText type="small" themeColor="primaryForeground">
                        ✓
                      </ThemedText>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      />

      {scrubbable && trackHeight > 0 && (
        <ScrollScrubber
          progress={progress}
          trackHeight={trackHeight}
          opacity={fade}
          label={label}
          scrubbing={scrubbing}
          onScrubStart={() => {
            setScrubbing(true);
            showScrubber(true);
          }}
          onScrubTo={onScrubTo}
          onScrubEnd={() => {
            setScrubbing(false);
            showScrubber();
          }}
        />
      )}

      {viewerIndex >= 0 && settings && (
        <PhotoViewer
          assets={flat}
          initialIndex={viewerIndex}
          settings={settings}
          onClose={() => setViewerIndex(-1)}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // gap/marginBottom are applied inline because they come from preferences.
  // No right padding: the scrubber floats over the edge of the grid (and only
  // while the list is moving), so tiles keep the full screen width.
  row: { flexDirection: 'row' },
  tile: { alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  sectionHeader: { paddingHorizontal: Spacing.two, paddingTop: Spacing.three, paddingBottom: Spacing.one },
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
