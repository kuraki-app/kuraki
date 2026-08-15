import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AlertButton,
  type ViewToken,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Dialog from '@/components/dialog';
import TagEditor from '@/components/tag-editor';
import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { formatBytes, formatTakenAt } from '@/lib/format';
import { backdropOpacity, clampZoom, shouldDismiss, ZOOM } from '@/lib/viewer-gestures';
import {
  fetchAssetTags,
  fullImageSource,
  videoSource,
  type LibraryAsset,
  type Tag,
} from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

type Props = {
  assets: LibraryAsset[];
  initialIndex: number;
  settings: CaptureSettings;
  onClose: () => void;
  onToggleFavorite?: (id: string, next: boolean) => void;
  /** Move this asset to trash. Omitted where deleting makes no sense — the
   *  Trash screen's own grid, and the Places viewer. */
  onDelete?: (id: string) => void;
};

/**
 * PhotoViewer is a full-screen, swipeable pager over the library grid. Images
 * use the best browser-safe source; videos play the original through
 * expo-video. Only the active video plays, so scrolling does not stack players.
 *
 * The chrome is a tap away and nothing else.
 *
 * It used to be a single row pinned to the top holding four text pills --
 * `Close`, the filename, `♡ Favorite`, `⊕ Tags` -- competing for a phone's
 * width. The filename sat between them with `flex: 1`, so it was always the
 * thing that lost, truncating to "Screensh…" while the buttons it was squeezed
 * between stayed at full width. It was also permanently on screen, over the
 * photo, whether or not it was wanted.
 *
 * Now: a tap toggles everything. Chrome up means two icons in the corners --
 * close at the top left, favourite at the top right, both far from the middle
 * of the image -- and an info button opening a details dialog that carries the
 * filename in full, along with everything else that was previously nowhere to
 * be found (capture date, size, place, tags). Chrome down means the photograph
 * alone.
 */
export default function PhotoViewer({
  assets,
  initialIndex,
  settings,
  onClose,
  onToggleFavorite,
  onDelete,
}: Props) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const width = Dimensions.get('window').width;
  const [active, setActive] = useState(initialIndex);
  const [chrome, setChrome] = useState(true);
  const [info, setInfo] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  // Set by whichever cell is zoomed, so the pager can stand down while it is.
  const [zoomed, setZoomed] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActive(first.index);
  }, []);

  const current = assets[active];

  // Tags are per-asset and not carried on LibraryAsset, so they are fetched as
  // the pager settles, and again when the tag editor closes. Failures are
  // silent: a tag list that will not load must not take down the photo it
  // belongs to, and the row simply stays empty.
  //
  // Keyed on the id rather than the asset object: toggling a favourite replaces
  // that object, which would otherwise refetch the tags on every heart tap.
  // Deferred a tick so the first setState does not fire synchronously inside
  // the effect, matching the pattern used across the app.
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setTags([]);
      fetchAssetTags(settings, currentId)
        .then((next) => {
          if (!cancelled) setTags(next);
        })
        .catch(() => {});
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [settings, currentId, editingTags]);

  /**
   * Deleting is irreversible-looking to the user even though it is a move to
   * trash, and the button sits one thumb-width from the favourite. Android's
   * Alert ignores `style` and assigns roles by position -- the LAST button is
   * the emphasised one -- so Cancel goes last there and first on iOS, leaving
   * the destructive action de-emphasised on both.
   */
  function confirmDelete(asset: LibraryAsset) {
    const buttons: AlertButton[] =
      Platform.OS === 'android'
        ? [
            { text: 'Move to trash', style: 'destructive', onPress: () => onDelete?.(asset.id) },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Move to trash', style: 'destructive', onPress: () => onDelete?.(asset.id) },
          ];
    Alert.alert('Move to trash?', asset.filename, buttons);
  }

  const place = current
    ? [current.place_city, current.place_country].filter(Boolean).join(', ')
    : '';
  const takenAt = formatTakenAt(current?.taken_at);
  const facts = [
    current?.size_bytes ? formatBytes(current.size_bytes) : '',
    current?.media_type === 'video' ? 'Video' : 'Photo',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/*
        A second GestureHandlerRootView, restored. An RN Modal is its own native
        window, which the app-level root in _layout.tsx does not reach, so any
        gesture in here needs its own -- it was dropped once when the details
        sheet became a dialog and nothing under here handled gestures any more.
        The cells pinch, pan and double-tap now, so it is load-bearing again:
        without it they are silently dead on Android.
      */}
      <GestureHandlerRootView style={styles.fill}>
        <FlatList
          data={assets}
          keyExtractor={(a) => a.id}
          horizontal
          pagingEnabled
          // A zoomed photo owns the pan: without this, dragging to look around
          // a magnified image would flick to the next photo instead.
          scrollEnabled={!zoomed}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          renderItem={({ item, index }) => (
            <ViewerCell
              asset={item}
              settings={settings}
              width={width}
              active={index === active}
              onPress={() => setChrome((on) => !on)}
              onZoomChange={setZoomed}
              onDismiss={onClose}
            />
          )}
        />

        {chrome && (
          <View style={[styles.top, { top: insets.top + Spacing.one }]} pointerEvents="box-none">
            <ChromeButton symbol="xmark" glyph="✕" label="Close" onPress={onClose} />
            <View style={styles.topActions}>
              {current && onToggleFavorite ? (
                <ChromeButton
                  symbol={current.favorite ? 'heart.fill' : 'heart'}
                  glyph={current.favorite ? '♥' : '♡'}
                  label={current.favorite ? 'Remove from favourites' : 'Add to favourites'}
                  tint={current.favorite ? tokens.destructive : undefined}
                  onPress={() => onToggleFavorite(current.id, !current.favorite)}
                />
              ) : null}
              {current ? (
                <ChromeButton
                  symbol="info.circle"
                  glyph="ⓘ"
                  label="Photo details"
                  onPress={() => setInfo(true)}
                />
              ) : null}
              {current && onDelete ? (
                <ChromeButton
                  symbol="trash"
                  // U+FE0E forces text presentation: the bare code point renders
                  // as a colour emoji on Android, noticeably heavier than the
                  // outline glyphs beside it.
                  glyph={'\u{1F5D1}\uFE0E'}
                  label="Move to trash"
                  onPress={() => confirmDelete(current)}
                />
              ) : null}
            </View>
          </View>
        )}

        {/*
          The caption. Deliberately only the two things worth reading over a
          photograph -- what it is and when it was taken. Everything else moved
          behind the info button, because a panel of metadata permanently
          covering the bottom fifth of the image is not what a viewer is for.
        */}
        {chrome && current && !info && !editingTags && (
          <View
            style={[styles.caption, { paddingBottom: insets.bottom + Spacing.four }]}
            pointerEvents="none">
            <ThemedText style={[heading, styles.captionName]} numberOfLines={2}>
              {current.filename}
            </ThemedText>
            {takenAt ? <ThemedText style={styles.captionMeta}>{takenAt}</ThemedText> : null}
          </View>
        )}

        {/*
          The details dialog, opened from the info button rather than shown with
          the chrome. Still hidden while the tag editor is up: one dialog at a
          time reads as a step, two stacked cards as a mistake.
        */}
        {current && (
          <Dialog
            visible={info && !editingTags}
            title={current.filename}
            register="kura"
            onClose={() => setInfo(false)}>
            <View style={styles.details}>
              {takenAt ? (
                <ThemedText type="small" themeColor="mutedForeground">
                  {takenAt}
                </ThemedText>
              ) : null}
              {facts ? (
                <ThemedText type="small" themeColor="mutedForeground">
                  {facts}
                </ThemedText>
              ) : null}
              {place ? (
                <ThemedText type="small" themeColor="mutedForeground">
                  {place}
                </ThemedText>
              ) : null}

              <View style={styles.tagRow}>
                {tags.map((t) => (
                  <View key={t.id} style={[styles.chip, { borderColor: tokens.border }]}>
                    <ThemedText type="small">{t.name}</ThemedText>
                  </View>
                ))}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setEditingTags(true)}
                  style={[styles.chip, styles.chipAction, { borderColor: tokens.input }]}>
                  <ThemedText type="small" themeColor="mutedForeground">
                    {tags.length ? 'Edit tags' : '＋ Tag'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </Dialog>
        )}

        {editingTags && current && (
          <TagEditor asset={current} settings={settings} onClose={() => setEditingTags(false)} />
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * ChromeButton is one of the two corner controls. Fixed light-on-dark inside a
 * translucent circle rather than themed, because it is drawn over a photograph
 * and not over the app's background — the same reasoning as the grid's size
 * badge.
 */
function ChromeButton({
  symbol,
  glyph,
  label,
  tint,
  onPress,
}: {
  symbol: SFSymbol;
  glyph: string;
  label: string;
  tint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={12}
      style={styles.chromeButton}>
      <SymbolView
        name={symbol}
        size={20}
        tintColor={tint ?? '#fff'}
        fallback={<ThemedText style={[styles.chromeGlyph, tint ? { color: tint } : null]}>{glyph}</ThemedText>}
      />
    </Pressable>
  );
}

function ViewerCell({
  asset,
  settings,
  width,
  active,
  onPress,
  onZoomChange,
  onDismiss,
}: {
  asset: LibraryAsset;
  settings: CaptureSettings;
  width: number;
  active: boolean;
  onPress: () => void;
  onZoomChange?: (zoomed: boolean) => void;
  onDismiss?: () => void;
}) {
  if (asset.media_type === 'video') {
    // No press-to-toggle wrapper on a video: the chrome would fight the
    // native transport controls for the same taps.
    return <VideoCell asset={asset} settings={settings} width={width} active={active} />;
  }
  // Split out rather than inlined, because ImageCell holds hooks and this
  // function returns early for video above — a hook after that would run
  // conditionally.
  return (
    <ImageCell
      asset={asset}
      settings={settings}
      width={width}
      onPress={onPress}
      onZoomChange={onZoomChange}
      onDismiss={onDismiss}
    />
  );
}

/**
 * One photo, with the viewer's three gestures on it.
 *
 * They have to be arranged so none of them steals another's start:
 *
 *   - Pinch zooms, and is the only two-finger gesture, so it never competes.
 *   - Pan does one of two jobs depending on the zoom. Zoomed in it moves the
 *     photo around; at rest it is the drag-to-dismiss, gated vertical-first so a
 *     sideways drag still reaches the pager underneath and turns the page.
 *   - Double-tap toggles between fit and 2x.
 *
 * All of them run on the JS thread (`runOnJS`). This app has no Reanimated
 * worklet code anywhere and no babel config to enable it; the scrubber drives
 * its drag through Animated from JS in exactly the same way, and a viewer that
 * matches it is worth more than a marginally smoother pinch on a path that
 * would be the only worklet in the codebase.
 */
function ImageCell({
  asset,
  settings,
  width,
  onPress,
  onZoomChange,
  onDismiss,
}: {
  asset: LibraryAsset;
  settings: CaptureSettings;
  width: number;
  onPress: () => void;
  onZoomChange?: (zoomed: boolean) => void;
  onDismiss?: () => void;
}) {
  // useMemo, not useRef().current: reading a ref during render is the thing the
  // React Compiler lint objects to, and this is the same shape the grid's
  // scrubber fade already uses.
  const scale = useMemo(() => new Animated.Value(1), []);
  const translateX = useMemo(() => new Animated.Value(0), []);
  const translateY = useMemo(() => new Animated.Value(0), []);
  const opacity = useMemo(() => new Animated.Value(1), []);
  // The committed values the next gesture starts from. Animated.Value has no
  // readable current value, so they are tracked alongside it.
  const zoom = useRef(1);
  const origin = useRef({ x: 0, y: 0 });

  const settle = useCallback(
    (next: number) => {
      zoom.current = next;
      onZoomChange?.(next > 1);
      if (next === 1) {
        origin.current = { x: 0, y: 0 };
        Animated.spring(translateX, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
        Animated.spring(translateY, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
      }
    },
    [onZoomChange, translateX, translateY],
  );

  const onPinch = useCallback(
    (s: number) => scale.setValue(clampZoom(zoom.current * s)),
    [scale],
  );

  const onPinchEnd = useCallback(
    (s: number) => {
      const next = clampZoom(zoom.current * s);
      scale.setValue(next);
      settle(next);
    },
    [scale, settle],
  );

  const onDoubleTap = useCallback(() => {
    const next = zoom.current > 1 ? ZOOM.min : 2;
    Animated.timing(scale, { toValue: next, duration: 180, useNativeDriver: false }).start();
    settle(next);
  }, [scale, settle]);

  const onDrag = useCallback(
    (dx: number, dy: number) => {
      if (zoom.current > 1) {
        translateX.setValue(origin.current.x + dx);
        translateY.setValue(origin.current.y + dy);
        return;
      }
      // At rest the drag is the dismissal: the photo follows the finger down and
      // the black behind it thins out, so the gesture shows its own outcome.
      translateY.setValue(dy);
      opacity.setValue(backdropOpacity(dy));
    },
    [translateX, translateY, opacity],
  );

  const onDragEnd = useCallback(
    (dx: number, dy: number, vy: number) => {
      if (zoom.current > 1) {
        origin.current = { x: origin.current.x + dx, y: origin.current.y + dy };
        return;
      }
      if (shouldDismiss(dy, vy)) {
        onDismiss?.();
        return;
      }
      Animated.spring(translateY, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
      Animated.spring(opacity, { toValue: 1, useNativeDriver: false, bounciness: 0 }).start();
    },
    [translateY, opacity, onDismiss],
  );

  /* eslint-disable react-hooks/refs -- Same false positive as photo-grid.tsx:
     the rule objects to the callbacks being handed to `.onUpdate(...)` during
     render because they eventually touch a ref, not to any read happening then.
     Nothing calls them until a finger does. */
  const gestures = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Pinch()
          .runOnJS(true)
          .onUpdate((e) => onPinch(e.scale))
          .onEnd((e) => onPinchEnd(e.scale)),
        Gesture.Race(
          Gesture.Tap()
            .numberOfTaps(2)
            .runOnJS(true)
            .onEnd(onDoubleTap),
          Gesture.Pan()
            // Vertical-first, and only far enough sideways to be sure: a
            // horizontal drag has to reach the pager under this cell so the
            // page still turns.
            .activeOffsetY([-15, 15])
            .failOffsetX([-20, 20])
            .runOnJS(true)
            .onUpdate((e) => onDrag(e.translationX, e.translationY))
            .onEnd((e) => onDragEnd(e.translationX, e.translationY, e.velocityY)),
        ),
      ),
    [onPinch, onPinchEnd, onDoubleTap, onDrag, onDragEnd],
  );
  /* eslint-enable react-hooks/refs */

  const source = fullImageSource(settings, asset);
  return (
    <GestureDetector gesture={gestures}>
      <Animated.View style={[styles.cell, { width, opacity }]}>
        <Pressable style={styles.fill} onPress={onPress}>
          {source ? (
            <Animated.View
              style={[styles.fill, { transform: [{ scale }, { translateX }, { translateY }] }]}>
              <Image
                source={source}
                style={styles.media}
                contentFit="contain"
                transition={150}
                cachePolicy="disk"
              />
            </Animated.View>
          ) : (
            <ThemedText style={styles.chromeGlyph}>Preview unavailable</ThemedText>
          )}
        </Pressable>
      </Animated.View>
    </GestureDetector>
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
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  // Fixed light-on-dark rather than themed, and shadowed rather than boxed: it
  // is drawn over a photograph whose brightness is unknown, and a solid plate
  // behind two lines of text would cover more of the image than the text does.
  captionName: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  captionMeta: {
    color: '#e6e2da',
    fontSize: 13,
    lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  chromeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  chromeGlyph: { color: '#fff' },
  details: { padding: Spacing.three, gap: Spacing.one },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, paddingTop: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  chipAction: { borderStyle: 'dashed' },
});
