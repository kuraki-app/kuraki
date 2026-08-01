import { useMemo } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { scrubProgress, thumbTop } from '@/lib/scrubber';

export const SCRUBBER_WIDTH = 32;
const THUMB_HEIGHT = 44;

type Props = {
  /** 0..1 position through the list. */
  progress: number;
  /** Height of the track area, measured by the parent. */
  trackHeight: number;
  /** Visible while scrolling or scrubbing; fades out when the list is idle. */
  opacity: Animated.Value;
  /** Month/year of the topmost visible row — shown only while dragging. */
  label: string;
  scrubbing: boolean;
  onScrubStart: () => void;
  onScrubTo: (progress: number) => void;
  onScrubEnd: () => void;
};

/**
 * ScrollScrubber is the draggable index on the right edge of the grid.
 *
 * There is no system control for this — iOS builds the Photos scrubber
 * privately and `showsVerticalScrollIndicator` is only an indicator, not a
 * grab handle — so unlike the tab bar this genuinely has to be built.
 *
 * It stays out of the way: the thumb only appears while the list is moving,
 * and the date bubble appears only while a finger is on it.
 */
export default function ScrollScrubber({
  progress,
  trackHeight,
  opacity,
  label,
  scrubbing,
  onScrubStart,
  onScrubTo,
  onScrubEnd,
}: Props) {
  const tokens = useTokens();

  // PanResponder captures its callbacks at creation, so this is memoised rather
  // than rebuilt each render, which would drop an in-flight gesture. trackHeight
  // is a dependency: it only changes on layout, never mid-drag.
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          onScrubStart();
          onScrubTo(scrubProgress(e.nativeEvent.locationY, trackHeight, THUMB_HEIGHT));
        },
        onPanResponderMove: (e) => {
          onScrubTo(scrubProgress(e.nativeEvent.locationY, trackHeight, THUMB_HEIGHT));
        },
        onPanResponderRelease: onScrubEnd,
        onPanResponderTerminate: onScrubEnd,
      }),
    [onScrubStart, onScrubTo, onScrubEnd, trackHeight],
  );

  const top = thumbTop(progress, trackHeight, THUMB_HEIGHT);

  return (
    <Animated.View
      style={[styles.track, { opacity, height: trackHeight }]}
      pointerEvents="box-none"
      {...responder.panHandlers}>
      {scrubbing && label ? (
        <View style={[styles.bubble, { top: top - 2, backgroundColor: tokens.primary }]}>
          <ThemedText type="smallBold" themeColor="primaryForeground">
            {label}
          </ThemedText>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Scroll through your library"
        style={[
          styles.thumb,
          { top, backgroundColor: tokens.card, borderColor: tokens.border },
          scrubbing && { backgroundColor: tokens.primary, borderColor: tokens.primary },
        ]}>
        <View style={[styles.grip, { backgroundColor: scrubbing ? tokens.primaryForeground : tokens.mutedForeground }]} />
        <View style={[styles.grip, { backgroundColor: scrubbing ? tokens.primaryForeground : tokens.mutedForeground }]} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: { position: 'absolute', right: 0, top: 0, width: SCRUBBER_WIDTH },
  thumb: {
    position: 'absolute',
    right: Spacing.half,
    width: SCRUBBER_WIDTH - Spacing.one,
    height: THUMB_HEIGHT,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  grip: { width: 10, height: 1.5, borderRadius: 1 },
  bubble: {
    position: 'absolute',
    right: SCRUBBER_WIDTH + Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
});
