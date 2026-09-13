import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import MotionPressable from '@/components/motion-pressable';
import { ThemedText } from '@/components/themed-text';
import { Layout, MaxContentWidth, Radius, Space, useTokens } from '@/constants/theme';

const links: { label: string; icon: SFSymbol; href: string }[] = [
  { label: 'Favorites', icon: 'star', href: '/(app)/(albums)/favorites' },
  { label: 'On this day', icon: 'calendar', href: '/(app)/(albums)/memories' },
  { label: 'Places', icon: 'map', href: '/(app)/(albums)/places' },
  { label: 'Tags', icon: 'tag', href: '/(app)/(albums)/tags' },
];

export default function CollectionLinks() {
  const tokens = useTokens();
  const { width } = useWindowDimensions();
  const frameWidth = Math.min(width, MaxContentWidth);
  const columns = width >= Layout.compactMax ? 4 : 2;
  const cardWidth = (frameWidth - Space.two * 2 - Space.two * (columns - 1)) / columns;

  return (
    <View style={styles.section}>
      <ThemedText style={[styles.title, { color: tokens.textFaint }]}>BROWSE</ThemedText>
      <View style={styles.grid}>
        {links.map((item) => (
          <MotionPressable
            key={item.href}
            accessibilityRole="button"
            style={[
              styles.card,
              { width: cardWidth, borderColor: tokens.border, backgroundColor: tokens.card },
            ]}
            onPress={() => router.push(item.href as Parameters<typeof router.push>[0])}>
            <SymbolView
              name={item.icon}
              size={23}
              tintColor={tokens.stamp}
              fallback={<ThemedText style={{ color: tokens.stamp }}>•</ThemedText>}
            />
            <ThemedText type="smallBold" numberOfLines={1}>{item.label}</ThemedText>
          </MotionPressable>
        ))}
      </View>
      <ThemedText style={[styles.title, { color: tokens.textFaint }]}>ALBUMS</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Space.two, paddingHorizontal: Space.two, paddingBottom: Space.three },
  title: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 1.2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.two },
  card: { minHeight: 76, justifyContent: 'space-between', padding: Space.two, borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth },
});
