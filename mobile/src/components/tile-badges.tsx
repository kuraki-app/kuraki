import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FontFamily } from '@/design/fonts';
import { formatDuration } from '@/lib/format';
import type { LibraryAsset } from '@/lib/library-api';

/**
 * TileBadges are the marks drawn over a grid thumbnail: favourite, video
 * length, and stack depth.
 *
 * What each corner means is fixed across the whole app, because a badge that
 * moves is a badge that has to be read rather than recognised:
 *
 *   top-right     stack depth, or the play triangle on a video
 *   bottom-left   favourite
 *   bottom-right  video length (and, when the preference is on, file size)
 *
 * The selection check deliberately keeps the top-right corner to itself — the
 * grid hides these badges outright while selecting, so the two can never
 * collide.
 *
 * Colours are fixed white-on-photograph rather than themed. These sit on an
 * image, not on the app's background, so a theme token would be answering the
 * wrong question; the shadow underneath is what keeps them legible over a
 * bright sky.
 */
export type TileBadgesProps = {
  asset: LibraryAsset;
  /** Draw the file-size badge (Settings > Photo Grid). */
  showSize?: boolean;
  /** Pre-formatted size, so the grid keeps ownership of the byte formatting. */
  sizeLabel?: string | null;
};

export default function TileBadges({ asset, showSize = false, sizeLabel }: TileBadgesProps) {
  const isVideo = asset.media_type === 'video';
  const duration = isVideo ? formatDuration(asset.duration_ms) : null;
  const stacked = (asset.stack_size ?? 0) > 1;
  const size = showSize && sizeLabel ? sizeLabel : null;

  return (
    <>
      {stacked ? (
        <View style={styles.topRight}>
          <Glyph name="square.stack" size={16} />
        </View>
      ) : isVideo ? (
        <View style={styles.topRight}>
          <Glyph name="play.fill" size={14} />
        </View>
      ) : null}

      {asset.favorite ? (
        <View style={styles.bottomLeft}>
          <Glyph name="heart.fill" size={15} />
        </View>
      ) : null}

      {duration || size ? (
        <View style={styles.bottomRight}>
          <ThemedText style={styles.meta}>{duration ?? size}</ThemedText>
        </View>
      ) : null}
    </>
  );
}

/**
 * Glyph is an SF Symbol with a text fallback, because `SymbolView` renders
 * nothing at all on Android — the same trap `toolbarGlyph` exists for in
 * screen-header.tsx. A tile with an invisible video marker looks like a
 * photograph, which is a worse failure than a slightly plain glyph.
 */
function Glyph({ name, size }: { name: 'play.fill' | 'heart.fill' | 'square.stack'; size: number }) {
  const fallback = name === 'play.fill' ? '▶' : name === 'heart.fill' ? '♥' : '▤';
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor="#ffffff"
      fallback={<ThemedText style={[styles.meta, { fontSize: size }]}>{fallback}</ThemedText>}
    />
  );
}

// A drop shadow rather than a pill: the contact sheet draws these marks
// directly on the photograph, and a chip behind each one turns a grid of
// pictures into a grid of chips.
const shadow = {
  textShadowColor: 'rgba(0,0,0,0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

const styles = StyleSheet.create({
  topRight: { position: 'absolute', top: 6, right: 6, ...shadow },
  bottomLeft: { position: 'absolute', bottom: 6, left: 6, ...shadow },
  bottomRight: { position: 'absolute', bottom: 6, right: 6 },
  meta: {
    color: '#ffffff',
    fontFamily: FontFamily.mono,
    fontSize: 12,
    lineHeight: 16,
    ...shadow,
  },
});
