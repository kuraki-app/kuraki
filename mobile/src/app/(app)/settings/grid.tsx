import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SettingsSection, SettingsSwitch } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { GROUP_OPTIONS, type GroupBy } from '@/lib/gallery';
import { DEFAULT_PREFS, GRID_COLUMNS, GRID_GAP, loadPrefs, savePrefs, type Prefs } from '@/lib/prefs';

export default function GridSettings() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    const timer = setTimeout(() => void loadPrefs().then(setPrefs), 0);
    return () => clearTimeout(timer);
  }, []);

  const patch = useCallback(async (next: Partial<Prefs>) => {
    setPrefs(await savePrefs(next));
  }, []);

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <SettingsSection
          title="Tiles"
          footer="Shows whether each item has reached your server, so you can tell at a glance what is safe.">
          <SettingsSwitch
            label="Show backup state"
            value={prefs.showBackupBadge}
            onValueChange={(v) => void patch({ showBackupBadge: v })}
          />
        </SettingsSection>

        <SettingsSection title="Layout">
          <Stepper
            label="Columns"
            value={prefs.gridColumns}
            min={GRID_COLUMNS.min}
            max={GRID_COLUMNS.max}
            onChange={(v) => void patch({ gridColumns: v })}
          />
          <Stepper
            label="Spacing"
            value={prefs.gridGap}
            min={GRID_GAP.min}
            max={GRID_GAP.max}
            step={2}
            onChange={(v) => void patch({ gridGap: v })}
          />
        </SettingsSection>

        <SettingsSection
          title="Grouping"
          footer="Grouping also drives the date shown while dragging the scroll indicator.">
          <Choice
            value={prefs.groupBy}
            options={GROUP_OPTIONS}
            onChange={(v) => void patch({ groupBy: v })}
          />
          <SettingsSwitch
            label="Show date headings"
            value={prefs.showGroupHeaders}
            disabled={prefs.groupBy === 'off'}
            onValueChange={(v) => void patch({ showGroupHeaders: v })}
          />
        </SettingsSection>
      </ScrollView>
    </ThemedView>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
}) {
  const tokens = useTokens();
  const button = (text: string, next: number, enabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text === '−' ? 'Decrease' : 'Increase'} ${label}`}
      disabled={!enabled}
      onPress={() => onChange(next)}
      style={[styles.stepButton, { borderColor: tokens.input, opacity: enabled ? 1 : 0.4 }]}>
      <ThemedText type="smallBold">{text}</ThemedText>
    </Pressable>
  );

  return (
    <View style={styles.row}>
      <ThemedText type="smallBold" style={styles.rowLabel}>
        {label}
      </ThemedText>
      <View style={styles.stepper}>
        {button('−', Math.max(min, value - step), value > min)}
        <ThemedText type="smallBold" style={styles.stepValue}>
          {value}
        </ThemedText>
        {button('+', Math.min(max, value + step), value < max)}
      </View>
    </View>
  );
}

function Choice({
  value,
  options,
  onChange,
}: {
  value: GroupBy;
  options: { key: GroupBy; label: string }[];
  onChange: (next: GroupBy) => void;
}) {
  const tokens = useTokens();
  return (
    <View style={styles.choiceRow}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.key)}
            style={[
              styles.choice,
              { borderColor: tokens.input },
              active && { backgroundColor: tokens.primary, borderColor: tokens.primary },
            ]}>
            <ThemedText type="small" themeColor={active ? 'primaryForeground' : undefined}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: Spacing.five },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.two, minHeight: 48 },
  rowLabel: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { minWidth: 24, textAlign: 'center', fontVariant: ['tabular-nums'] },
  choiceRow: { flexDirection: 'row', gap: Spacing.one, paddingVertical: Spacing.two },
  choice: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
});
