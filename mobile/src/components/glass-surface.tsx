import { BlurTargetView, BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { useTokens } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePrefs } from '@/hooks/use-prefs';
import { useReducedTransparency } from '@/hooks/use-reduced-transparency';
import { resolveGlassSurface, type GlassVariant } from '@/lib/glass-surface';

const Target = createContext<RefObject<View | null> | undefined>(undefined);

/** The content and its controls are siblings, so Android samples only content,
 * never the blur itself. Keep this scene inside the controls' native window. */
export function GlassScene({ content, children }: { content: ReactNode; children: ReactNode }) {
  const target = useRef<View>(null);
  return (
    <Target.Provider value={target}>
      <BlurTargetView ref={target} style={styles.fill}>{content}</BlurTargetView>
      {children}
    </Target.Provider>
  );
}

/** App-owned chrome only. Native Stack headers and NativeTabs own their own
 * materials. Overlays are separate Modal windows and never inherit a target. */
export default function GlassSurface({
  variant,
  appearance,
  style,
  children,
  ...props
}: ViewProps & { variant: GlassVariant; appearance?: 'dark' }) {
  const tokens = useTokens();
  const scheme = useColorScheme();
  const { transparency } = usePrefs();
  const reduced = useReducedTransparency();
  const target = useContext(Target);
  const blurTarget = variant === 'overlay' ? undefined : target;
  const dark = appearance === 'dark' || scheme === 'dark';
  const material = resolveGlassSurface({
    platform: Platform.OS,
    version: Number.parseFloat(String(Platform.Version)),
    liquidGlassAvailable: Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable(),
    reduceTransparency: reduced,
    preference: transparency,
    hasBlurTarget: !!blurTarget,
  });
  const variants = {
    navigation: { tint: tokens.glassNavigationTint, blur: tokens.glassNavigationBlur },
    overlay: { tint: tokens.glassOverlayTint, blur: tokens.glassOverlayBlur },
    floating: { tint: tokens.glassFloatingTint, blur: tokens.glassFloatingBlur },
  };
  const tint = appearance === 'dark' ? tokens.glassChromeTint : variants[variant].tint;
  const opaque = appearance === 'dark' ? tokens.glassChromeOpaque : tokens.glassOpaque;

  return (
    <View {...props} style={[styles.surface, { borderColor: tokens.glassBorder }, style]}>
      {material === 'glass' ? (
        <GlassView pointerEvents="none" style={StyleSheet.absoluteFill} glassEffectStyle="regular"
          colorScheme={dark ? 'dark' : 'light'} tintColor={tint} />
      ) : material === 'blur' ? (
        <BlurView pointerEvents="none" style={StyleSheet.absoluteFill} blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus" tint={dark ? 'dark' : 'light'}
          intensity={Number.parseFloat(variants[variant].blur)} />
      ) : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        backgroundColor: material === 'opaque' ? opaque : material === 'blur' ? tint : 'transparent',
      }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  surface: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
});
