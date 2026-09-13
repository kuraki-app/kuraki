import { useEffect, useState } from 'react';
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export default function MotionProgress({
  fraction,
  color,
  style,
}: {
  fraction: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(Math.max(0, Math.min(1, fraction))));

  useEffect(() => {
    const next = Math.max(0, Math.min(1, fraction));
    if (reduced) {
      progress.setValue(next);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: next,
      duration: Motion.settle,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [fraction, progress, reduced]);

  return (
    <Animated.View
      style={[
        styles.fill,
        style,
        {
          backgroundColor: color,
          width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { height: '100%', borderRadius: 3 },
});
