import { useState } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Rows move less than standalone cards while keeping the same timing. */
  pressedScale?: number;
};

/** Native press feedback shared by durable rows and cards. */
export default function MotionPressable({
  style,
  pressedScale = Motion.pressScale,
  onPressIn,
  onPressOut,
  disabled,
  ...props
}: Props) {
  const reduced = useReducedMotion();
  const [pressed] = useState(() => new Animated.Value(0));

  function animate(toValue: 0 | 1) {
    pressed.stopAnimation();
    if (reduced || disabled) {
      pressed.setValue(0);
      return;
    }
    Animated.timing(pressed, {
      toValue,
      duration: toValue ? Motion.instant : Motion.crisp,
      useNativeDriver: true,
    }).start();
  }

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={(event) => {
        animate(1);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(0);
        onPressOut?.(event);
      }}
      style={[
        style,
        {
          opacity: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }),
          transform: [
            { scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, pressedScale] }) },
          ],
        },
      ]}
    />
  );
}
