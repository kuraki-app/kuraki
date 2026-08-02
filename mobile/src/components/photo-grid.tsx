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
import { formatBytes } from '@/lib/format';
import { groupAssets, type PhotoRow } from '@/lib/gallery';
import { sectionAllSelected, sectionIds } from '@/lib/selection';
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
  /** Move a single asset to trash from inside the viewer. Surfaces the delete
   *  icon only where a caller supplies it — the Trash grid and the Places
   *  viewer deliberately do not. */
  onDelete?: (id: string) => void;
  // Selection mode: the owning screen holds the Set<string> of selected ids so
  // bulk actions (add to album, trash) can mutate its own asset list.
  // Selection is "active" whenever the set is non-empty — a tap toggles
  // membership instead of opening the viewer, and a long-press on any tile
  // (even outside selection mode) starts it.
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onLongPressItem?: (id: string) => void;
  /**
   * Force selection behaviour on even with nothing selected yet.
   *
   * Selection used to be inferred purely from "the set is non-empty", which
   * works for long-press (the gesture selects the tile that starts it) but
   * cannot express "the user pressed Select and has chosen nothing yet" — in
   * that state a tap would have opened the viewer instead of selecting. The
   * album picker needs the same thing permanently.
   */
  selectionMode?: boolean;
  /**
   * Select or clear a whole date group from its heading.
   *
   * Only meaningful while selecting, and only offered then: a control sitting
   * in every heading all the time would be a permanent invitation to a mode the
   * user is not in. `allSelected` says which way the tap should go, so the
   * caller does not have to recompute what the heading already knows.
   */
  onSelectSection?: (ids: string[], allSelected: boolean) => void;
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
  onDelete,
  selectedIds,
  onToggleSelect,
  onLongPressItem,
  selectionMode = false,
  onSelectSection,
}: Props) {
  const tokens = useTokens();
  // Layout and grouping are preferences, read here rather than threaded through
  // every caller: there is one grid, and Settings > Photo Grid is its one
  // source of truth.
  const { gridColumns: columns, gridGap: gap, groupBy, showGroupHeaders, showSizeBadge } = usePrefs();
  const [viewerIndex, setViewerIndex] = useState(-1);
  const selectionActive = selectionMode || (!!selectedIds && selectedIds.size > 0);

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
        renderSectionHeader={({ section }) => {
          const selectAll = selectionActive && onSelectSection;
          if (!showGroupHeaders || !section.title) {
            // With headings switched off there is nothing to hang the control
            // on, so per-group selection simply is not offered.
            return null;
          }
          const allSelected = selectAll ? sectionAllSelected(section, selectedIds ?? new Set()) : false;
          return (
            <View style={styles.sectionRow}>
              <ThemedText type="smallBold" style={styles.sectionHeader}>
                {section.title}
              </ThemedText>
              {selectAll ? (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${allSelected ? 'Deselect' : 'Select'} everything in ${section.title}`}
                  onPress={() => onSelectSection(sectionIds(section), allSelected)}>
                  <ThemedText type="smallBold" themeColor="primary">
                    {allSelected ? 'None' : 'Select all'}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          );
        }}
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
                  {showSizeBadge && item.size_bytes ? (
                    <View style={styles.sizeBadge}>
                      <ThemedText type="small" style={styles.sizeText}>
                        {formatBytes(item.size_bytes)}
                      </ThemedText>
                    </View>
                  ) : null}
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
          onDelete={
            onDelete
              ? (id) => {
                  // Close first: the asset is about to leave the list, and a
                  // pager still pointing at it would render an empty page.
                  setViewerIndex(-1);
                  onDelete(id);
                }
              : undefined
          }
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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
  },
  sectionHeader: { paddingTop: Spacing.three, paddingBottom: Spacing.one },
  // Bottom-right, so it never sits under the selection check in the corner
  // opposite. Fixed light-on-dark rather than themed: it is drawn over a
  // photograph, not over the app's background.
  sizeBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sizeText: { color: '#fff', fontSize: 10, lineHeight: 14 },
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
