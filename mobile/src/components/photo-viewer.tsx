import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  useWindowDimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AlertButton,
  type ViewToken,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Animated from 'react-native-reanimated';

import Dialog from '@/components/dialog';
import GlassSurface, { GlassScene } from '@/components/glass-surface';
import { useViewerGestures } from '@/hooks/use-viewer-gestures';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import TagEditor from '@/components/tag-editor';
import { ThemedText } from '@/components/themed-text';
import { Space, useTokens } from '@/constants/theme';
import { FontFamily } from '@/design/fonts';
import { registerStyle } from '@/design/registers';
import DetailFacts from '@/components/detail-facts';
import { assetFacts, type AssetFact } from '@/lib/asset-facts';
import { formatTakenAt } from '@/lib/format';
import {
  fetchAssetDetail,
  fetchAssetTags,
  fullImageSource,
  thumbSource,
  videoSource,
  type LibraryAsset,
  type Tag,
} from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

// Kura, not Vault. `design/registers.ts` states the rule outright — "the photo
// grid and viewer always render kura regardless" — because the register belongs
// to the page frame and a photograph is never an operational surface. This read
// 'vault', which set the one caption in the app that sits on an image in the
// mono data face.
const reg = registerStyle('kura');
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
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const [active, setActive] = useState(initialIndex);
  const [chrome, setChrome] = useState(true);
  const [info, setInfo] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  // Set by whichever cell is zoomed, so the pager can stand down while it is.
  const [zoomed, setZoomed] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  // The full record for the details sheet. LibraryAsset deliberately omits
  // dimensions, camera and MIME, so the sheet fetches them for the one asset
  // it is about rather than every list response carrying them.
  const [facts, setFacts] = useState<AssetFact[]>([]);

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
    if (!info || !currentId) return;
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
  }, [settings, currentId, editingTags, info]);

  // Fetched when the sheet opens rather than as the pager settles: swiping
  // through a hundred photographs should not fire a hundred detail requests for
  // a panel nobody has asked for. Failures leave the list empty and the sheet
  // still opens -- it also carries the tag row, which is worth showing on its
  // own.
  useEffect(() => {
    if (!info || !currentId) return;
    let cancelled = false;
    // Deferred a tick so the first setState does not fire synchronously inside
    // the effect, matching the tags effect above and the pattern used across
    // the app.
    const timer = setTimeout(() => {
      setFacts([]);
      fetchAssetDetail(settings, currentId)
        .then((detail) => {
          if (!cancelled) setFacts(assetFacts(detail));
        })
        .catch(() => {});
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [settings, currentId, info]);

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
  // Where as well as when. Place was already derived for the details dialog but
  // never shown with the photograph, which is the one place it reads as part of
  // the picture rather than as a field.
  const caption = [takenAt, place].filter(Boolean).join(' · ');
  return (
    <Modal visible animationType={reduced ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      {/*
        A second GestureHandlerRootView, restored. An RN Modal is its own native
        window, which the app-level root in _layout.tsx does not reach, so any
        gesture in here needs its own -- it was dropped once when the details
        sheet became a dialog and nothing under here handled gestures any more.
        The cells pinch, pan and double-tap now, so it is load-bearing again:
        without it they are silently dead on Android.
      */}
      <GestureHandlerRootView style={styles.fill}>
        <GlassScene content={
        <FlatList
          key={width}
          data={assets}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          keyExtractor={(a) => a.id}
          horizontal
          pagingEnabled
          // A zoomed photo owns the pan: without this, dragging to look around
          // a magnified image would flick to the next photo instead.
          scrollEnabled={!zoomed}
          initialScrollIndex={active}
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
        }>

        {chrome && (
          <View style={[styles.top, { top: insets.top + Space.one }]} pointerEvents="box-none">
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
            style={[styles.caption, { paddingBottom: insets.bottom + Space.five }]}
            pointerEvents="none">
            <ThemedText style={[heading, styles.captionName]} numberOfLines={2}>
              {current.filename}
            </ThemedText>
            {caption ? <ThemedText style={styles.captionMeta}>{caption}</ThemedText> : null}
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
              <DetailFacts facts={facts} />

              <ThemedText style={[styles.factsLabel, { color: tokens.textFaint }]}>TAGS</ThemedText>
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
        </GlassScene>
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
      <GlassSurface variant="floating" appearance="dark" style={styles.chromeSurface}>
      <SymbolView
        name={symbol}
        size={20}
        tintColor={tint ?? '#fff'}
        fallback={<ThemedText style={[styles.chromeGlyph, tint ? { color: tint } : null]}>{glyph}</ThemedText>}
      />
      </GlassSurface>
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
 * Gesture state lives in useViewerGestures. Expo configures the installed
 * Reanimated/Worklets runtime through babel-preset-expo.
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
  const { gesture, cellStyle, imageStyle } = useViewerGestures({ onZoomChange, onDismiss });
  const reduced = useReducedMotion();

  const source = fullImageSource(settings, asset);
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.cell, { width }, cellStyle]}>
        {/*
          `layer`, not `fill`. The cell centres its children (`alignItems:
          'center'`), which in a column flexbox means they size to their content
          across the axis rather than stretching — so a bare `flex: 1` wrapper
          here is full height and ZERO WIDTH. The image asks for `width: '100%'`
          of that, gets nothing, and the viewer is a black screen. It worked
          before only because the image was a direct child of the cell, whose
          width is explicit; inserting these two wrappers to hang the gesture
          transform on is what broke it. `alignSelf: 'stretch'` opts each wrapper
          back out of the centring.
        */}
        <Pressable style={styles.layer} onPress={onPress}>
          {source ? (
            <Animated.View
              style={[styles.layer, imageStyle]}>
              <Image
                source={source}
                placeholder={thumbSource(settings, asset)}
                placeholderContentFit="contain"
                recyclingKey={source.uri}
                style={styles.media}
                contentFit="contain"
                transition={reduced ? 0 : 150}
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
  const player = useVideoPlayer(active && src ? { uri: src.uri, headers: src.headers } : null, (p) => {
    p.loop = false;
  });
  // Play only while this cell is the visible page.
  const playable = !!src;
  useEffect(() => {
    if (active && playable) player.play();
    else player.pause();
  }, [active, player, playable]);

  return (
    <View style={[styles.cell, { width }]}>
      {src ? (
        <VideoView player={player} style={styles.media} contentFit="contain" nativeControls />
      ) : (
        <ThemedText style={styles.chromeGlyph}>Playback unavailable. The original is stored on your server.</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  // A full-bleed layer inside `cell`. alignSelf overrides the cell's
  // alignItems: 'center', which would otherwise leave this zero-width.
  layer: { flex: 1, alignSelf: 'stretch' },
  media: { width: '100%', height: '100%' },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.four,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: Space.two },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Space.four,
    gap: 2,
  },
  // Fixed light-on-dark rather than themed, and shadowed rather than boxed: it
  // is drawn over a photograph whose brightness is unknown, and a solid plate
  // behind two lines of text would cover more of the image than the text does.
  captionName: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 26,
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
  },
  chromeSurface: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chromeGlyph: { color: '#fff' },
  details: { padding: Space.four, gap: Space.one },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.one, paddingTop: Space.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Space.two, paddingVertical: Space.one },
  factsLabel: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 1.4,
    paddingTop: Space.one,
  },
  chipAction: { borderStyle: 'dashed' },
});
