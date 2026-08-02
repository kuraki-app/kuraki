import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Dialog from '@/components/dialog';
import TagEditor from '@/components/tag-editor';
import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { formatBytes, formatTakenAt } from '@/lib/format';
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
        A plain View. This used to be a second GestureHandlerRootView, because
        an RN Modal is its own native window that the app-level root in
        _layout.tsx does not reach, and the details sheet's drag needed one on
        Android. Nothing under here uses a gesture handler now that the sheets
        are dialogs -- the pager is a plain FlatList -- so the extra native root
        would only be a thing to explain.
      */}
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
            <ViewerCell
              asset={item}
              settings={settings}
              width={width}
              active={index === active}
              onPress={() => setChrome((on) => !on)}
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
      </View>
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
}: {
  asset: LibraryAsset;
  settings: CaptureSettings;
  width: number;
  active: boolean;
  onPress: () => void;
}) {
  if (asset.media_type === 'video') {
    // No press-to-toggle wrapper on a video: the chrome would fight the
    // native transport controls for the same taps.
    return <VideoCell asset={asset} settings={settings} width={width} active={active} />;
  }
  const source = fullImageSource(settings, asset);
  return (
    <Pressable style={[styles.cell, { width }]} onPress={onPress}>
      {source ? (
        <Image source={source} style={styles.media} contentFit="contain" transition={150} cachePolicy="disk" />
      ) : (
        <ThemedText style={styles.chromeGlyph}>Preview unavailable</ThemedText>
      )}
    </Pressable>
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
  details: { padding: Spacing.three, gap: Spacing.half },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, paddingTop: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half },
  chipAction: { borderStyle: 'dashed' },
});
