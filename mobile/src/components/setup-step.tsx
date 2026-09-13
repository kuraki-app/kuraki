import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
} from 'react-native';

import MotionPressable from '@/components/motion-pressable';
import { ThemedText } from '@/components/themed-text';
import { Motion, Radius, Space, useTokens } from '@/constants/theme';
import { FontFamily } from '@/design/fonts';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

type SetupStepProps = {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  symbol: SFSymbol;
  symbolFallback: string;
};

/** One responsive, animated frame for every onboarding page. */
export default function SetupStep({
  children,
  eyebrow,
  title,
  description,
  symbol,
  symbolFallback,
}: SetupStepProps) {
  const tokens = useTokens();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  const [translateY] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    opacity.setValue(0);
    translateY.setValue(6);
    const entrance = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: Motion.settle,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: Motion.settle,
        useNativeDriver: true,
      }),
    ]);
    entrance.start();
    return () => entrance.stop();
  }, [opacity, reduced, translateY]);

  return (
    <ScrollView
      style={{ backgroundColor: tokens.background }}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentInsetAdjustmentBehavior="automatic">
      <Animated.View style={[styles.content, { opacity, transform: [{ translateY }] }]}>
        <View style={styles.headingRow}>
          <View
            style={[
              styles.symbol,
              { backgroundColor: tokens.secondary, borderColor: tokens.border },
            ]}>
            <SymbolView
              name={symbol}
              size={28}
              tintColor={tokens.stamp}
              fallback={
                <ThemedText type="smallBold" style={{ color: tokens.stamp }}>
                  {symbolFallback}
                </ThemedText>
              }
            />
          </View>
          <View style={styles.headingCopy}>
            <ThemedText style={[styles.eyebrow, { color: tokens.stamp }]}>
              {eyebrow.toUpperCase()}
            </ThemedText>
            <ThemedText type="title">{title}</ThemedText>
          </View>
        </View>
        <ThemedText themeColor="textDim">{description}</ThemedText>
        <View style={styles.controls}>{children}</View>
      </Animated.View>
    </ScrollView>
  );
}

export function SetupButton({
  label,
  variant = 'primary',
  disabled,
  ...props
}: Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const tokens = useTokens();
  const primary = variant === 'primary';

  return (
    <MotionPressable
      {...props}
      accessibilityRole="button"
      disabled={disabled}
      style={[
        styles.button,
        {
          backgroundColor: primary ? tokens.primary : tokens.secondary,
          borderColor: primary ? tokens.primary : tokens.border,
          opacity: disabled ? 0.48 : 1,
        },
      ]}>
      <ThemedText
        type="smallBold"
        style={{ color: primary ? tokens.primaryForeground : tokens.secondaryForeground }}>
        {label}
      </ThemedText>
    </MotionPressable>
  );
}

export function SetupField({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const tokens = useTokens();
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      {...props}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      placeholderTextColor={tokens.textFaint}
      selectionColor={tokens.stamp}
      style={[
        styles.input,
        {
          backgroundColor: tokens.card,
          borderColor: focused ? tokens.ring : tokens.border,
          color: tokens.foreground,
        },
        style,
      ]}
    />
  );
}

export function SetupCard({ children }: { children: ReactNode }) {
  const tokens = useTokens();
  return (
    <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      {children}
    </View>
  );
}

export function SetupNotice({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'error';
}) {
  const tokens = useTokens();
  const color = tone === 'success' ? tokens.ok : tone === 'error' ? tokens.destructive : tokens.textFaint;
  const backgroundColor =
    tone === 'success' ? tokens.okBg : tone === 'error' ? tokens.destructiveBg : tokens.secondary;

  return (
    <View style={[styles.notice, { backgroundColor }]}>
      <View style={[styles.noticeDot, { backgroundColor: color }]} />
      <ThemedText type="small" style={[styles.noticeText, { color }]}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.four,
    paddingVertical: Space.six,
  },
  content: {
    width: '100%',
    maxWidth: 520,
    gap: Space.four,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: Space.three },
  headingCopy: { flex: 1, gap: Space.half },
  symbol: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  controls: { gap: Space.three, marginTop: Space.two },
  button: {
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.four,
    paddingVertical: Space.three,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space.four,
    fontFamily: FontFamily.medium,
    fontSize: 16,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Space.four,
    gap: Space.one,
  },
  notice: {
    minHeight: 44,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.two,
    paddingHorizontal: Space.three,
    paddingVertical: Space.two,
  },
  noticeDot: { width: 7, height: 7, borderRadius: 4 },
  noticeText: { flex: 1 },
});
