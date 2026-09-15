import { Gesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { backdropOpacity, clampZoom, shouldDismiss } from '@/lib/viewer-gestures';

/** Owns gesture arbitration, committed zoom/pan and animated styles. Only the
 * zoom lock and completed dismissal cross to React; frame updates stay on UI. */
export function useViewerGestures({
  onZoomChange,
  onDismiss,
}: {
  onZoomChange?: (zoomed: boolean) => void;
  onDismiss?: () => void;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const zoom = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const opacity = useSharedValue(1);

  function settle(next: number) {
    'worklet';
    zoom.set(next);
    if (onZoomChange) scheduleOnRN(onZoomChange, next > 1);
    if (next === 1) {
      originX.set(0);
      originY.set(0);
      x.set(reduced ? 0 : withSpring(0, { overshootClamping: true }));
      y.set(reduced ? 0 : withSpring(0, { overshootClamping: true }));
    }
  }

  const pinch = Gesture.Pinch()
    .onUpdate((event) => { scale.set(clampZoom(zoom.get() * event.scale)); })
    .onEnd((event) => {
      const next = clampZoom(zoom.get() * event.scale);
      scale.set(next);
      settle(next);
    })
    .onFinalize((_event, success) => { if (!success) scale.set(zoom.get()); });
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd((_event, success) => {
    if (!success) return;
    const next = zoom.get() > 1 ? 1 : 2;
    scale.set(reduced ? next : withTiming(next, { duration: Motion.crisp }));
    settle(next);
  });
  const pan = Gesture.Pan()
    // Preserve vertical-first activation so a horizontal swipe reaches the pager.
    .activeOffsetY([-15, 15])
    .failOffsetX([-20, 20])
    .onUpdate((event) => {
      if (zoom.get() > 1) {
        x.set(originX.get() + event.translationX);
        y.set(originY.get() + event.translationY);
      } else {
        y.set(event.translationY);
        opacity.set(reduced ? 1 : backdropOpacity(event.translationY));
      }
    })
    .onEnd((event) => {
      if (zoom.get() > 1) {
        originX.set(originX.get() + event.translationX);
        originY.set(originY.get() + event.translationY);
      } else if (shouldDismiss(event.translationY, event.velocityY) && onDismiss) {
        scheduleOnRN(onDismiss);
      }
    })
    .onFinalize(() => {
      if (zoom.get() === 1) {
        y.set(reduced ? 0 : withSpring(0, { overshootClamping: true }));
        opacity.set(reduced ? 1 : withSpring(1, { overshootClamping: true }));
      } else {
        x.set(originX.get());
        y.set(originY.get());
      }
    });

  const cellStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }, { translateX: x.get() }, { translateY: y.get() }],
  }));
  return { gesture: Gesture.Simultaneous(pinch, Gesture.Race(doubleTap, pan)), cellStyle, imageStyle };
}
