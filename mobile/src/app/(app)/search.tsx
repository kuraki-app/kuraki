import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function SearchScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={[styles.fill, { paddingTop: insets.top }]}>
      <ThemedText type="title">Search</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, padding: Spacing.three } });
