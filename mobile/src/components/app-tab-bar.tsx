// expo-router vendors react-navigation; `expo-router/js-tabs` is its public
// subpath for the JS bottom-tabs types, and @react-navigation/bottom-tabs is
// not a direct dependency of this app.
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePillState } from '@/components/scroll-reporter';
import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { TAB_BAR_HEIGHT } from '@/lib/tab-bar';

// Destinations shown in the left pill, in order. Gallery is first and is the
// default route. Search is deliberately absent -- it is the separate button on
// the right, so it stays reachable whatever the pill is doing.
const PILL_ROUTES: { name: string; label: string; sf: SFSymbol; glyph: string }[] = [
  { name: 'index', label: 'Gallery', sf: 'photo.on.rectangle', glyph: '▤' },
  { name: 'albums', label: 'Albums', sf: 'rectangle.stack', glyph: '▣' },
  { name: 'settings', label: 'Settings', sf: 'gearshape', glyph: '⚙' },
];

const PILL_HEIGHT = TAB_BAR_HEIGHT - Spacing.two * 2;

export default function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const pill = usePillState();
  const activeName = state.routes[state.index]?.name;

  function go(name: string) {
    const target = state.routes.find((r) => r.name === name);
    const event = navigation.emit({
      type: 'tabPress',
      target: target?.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) navigation.navigate(name);
  }

  return (
    <View
      style={[styles.bar, { paddingBottom: insets.bottom + Spacing.two }]}
      pointerEvents="box-none">
      <Animated.View
        layout={LinearTransition.duration(180)}
        style={[styles.pill, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
        {PILL_ROUTES.map((route) => {
          const active = route.name === activeName;
          // Collapsed shows only the active destination; expanded shows all.
          if (pill === 'collapsed' && !active) return null;
          const tint = active ? tokens.primaryForeground : tokens.foreground;
          return (
            <Pressable
              key={route.name}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={route.label}
              onPress={() => go(route.name)}
              style={[styles.item, active && { backgroundColor: tokens.primary }]}>
              <SymbolView
                name={route.sf}
                size={20}
                tintColor={tint}
                fallback={<ThemedText style={{ color: tint }}>{route.glyph}</ThemedText>}
              />
              {active && (
                <ThemedText type="smallBold" themeColor="primaryForeground">
                  {route.label}
                </ThemedText>
              )}
            </Pressable>
          );
        })}
      </Animated.View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search"
        onPress={() => go('search')}
        style={[styles.search, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
        <SymbolView
          name="magnifyingglass"
          size={20}
          tintColor={tokens.foreground}
          fallback={<ThemedText>⌕</ThemedText>}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    height: PILL_HEIGHT,
    paddingHorizontal: Spacing.one,
    borderWidth: 1,
    borderRadius: 999,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    minHeight: 40,
  },
  search: {
    alignItems: 'center',
    justifyContent: 'center',
    width: PILL_HEIGHT,
    height: PILL_HEIGHT,
    borderWidth: 1,
    borderRadius: 999,
  },
});
