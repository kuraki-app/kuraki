import { ScrollView, StyleSheet, View } from 'react-native';

import MotionPressable from '@/components/motion-pressable';
import { SettingsSection } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Layout, MaxContentWidth, Space, useTokens } from '@/constants/theme';
import { usePrefs } from '@/hooks/use-prefs';
import { savePrefs } from '@/lib/prefs';
import type { TransparencyPreference } from '@/lib/glass-surface';

const choices: { value: TransparencyPreference; label: string; detail: string }[] = [
  { value: 'system', label: 'System', detail: 'Follow this device’s accessibility settings.' },
  { value: 'reduced', label: 'Reduced', detail: 'Use solid backgrounds behind controls.' },
  { value: 'enabled', label: 'Enabled', detail: 'Use translucent controls where supported.' },
];

export default function AppearanceSettings() {
  const tokens = useTokens();
  const prefs = usePrefs();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic"
      style={[styles.fill, { backgroundColor: tokens.background }]} contentContainerStyle={styles.content}>
      <SettingsSection title="Transparency"
        footer="Reduce Transparency in your device’s accessibility settings always takes priority. Motion follows your device’s Reduce Motion setting separately.">
        {choices.map(({ value, label, detail }) => (
          <MotionPressable key={value} accessibilityRole="radio"
            accessibilityState={{ checked: prefs.transparency === value }}
            accessibilityLabel={`${label}. ${detail}`}
            onPress={() => void savePrefs({ transparency: value })} style={styles.row}>
            <View style={styles.label}>
              <ThemedText type="smallBold">{label}</ThemedText>
              <ThemedText type="small" themeColor="mutedForeground">{detail}</ThemedText>
            </View>
            {prefs.transparency === value ? <ThemedText accessibilityElementsHidden>✓</ThemedText> : null}
          </MotionPressable>
        ))}
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Space.five },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.two, paddingVertical: Space.two, minHeight: Layout.touchTarget },
  label: { flex: 1, gap: Space.half },
});
