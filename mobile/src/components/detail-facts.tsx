import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import type { AssetFact } from '@/lib/asset-facts';

// SF Symbol per fact kind. Kept here rather than in `asset-facts.ts` so that
// module stays free of anything platform-shaped and testable in plain Node.
const SYMBOLS: Record<AssetFact['icon'], SFSymbol> = {
  doc: 'doc',
  clock: 'clock',
  camera: 'camera',
  mappin: 'mappin',
};

/**
 * DetailFacts is the body of the details sheet: one card per fact.
 *
 * The dialog previously listed three unlabelled muted lines — a date, a size,
 * a place — set identically, so nothing distinguished a value from any other
 * value and nothing said what any of them were. Each fact is now a card with
 * its own mark, the answer on the first line and what kind of answer it is on
 * the second.
 *
 * Rows come from `assetFacts`, which omits anything the asset carries no data
 * for, so this renders no empty states of its own.
 */
export default function DetailFacts({ facts }: { facts: AssetFact[] }) {
  const tokens = useTokens();

  return (
    <View style={styles.list}>
      {facts.map((fact) => (
        <View key={fact.key} style={[styles.card, { backgroundColor: tokens.secondary }]}>
          <SymbolView
            name={SYMBOLS[fact.icon]}
            size={20}
            tintColor={tokens.textDim}
            fallback={<View style={styles.iconSpacer} />}
          />
          <View style={styles.text}>
            <ThemedText style={styles.primary} numberOfLines={2}>
              {fact.primary}
            </ThemedText>
            <ThemedText type="small" themeColor="textFaint" numberOfLines={1}>
              {fact.secondary}
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.one },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    minHeight: 62,
  },
  iconSpacer: { width: 20 },
  text: { flex: 1, gap: 1 },
  // 14/500: the value leads, but it is a data row inside a sheet, not a heading.
  primary: { fontSize: 14, lineHeight: 19, fontWeight: '500' },
});
