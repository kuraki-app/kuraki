import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';

// The shared vocabulary of the settings tree: a titled section, a grouped card,
// a row that pushes to a subpage, and a row carrying a switch. Every settings
// screen is built from these so spacing, dividers and hit targets stay
// identical across six pages instead of drifting per file.

export function SettingsSection({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? (
        <ThemedText type="smallBold" themeColor="mutedForeground" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </ThemedText>
      ) : null}
      <ThemedView type="card" style={styles.card}>
        {children}
      </ThemedView>
      {footer ? (
        <ThemedText type="small" themeColor="mutedForeground" style={styles.footer}>
          {footer}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function SettingsRow({
  label,
  detail,
  icon,
  href,
  onPress,
  destructive,
}: {
  label: string;
  detail?: string;
  icon?: SFSymbol;
  href?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const tokens = useTokens();
  const color = destructive ? tokens.destructive : tokens.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      style={styles.row}
      // `href` is a plain string prop, which typed routes cannot narrow at this
      // boundary; the routes themselves are still checked at every call site.
      onPress={onPress ?? (href ? () => router.push(href as Parameters<typeof router.push>[0]) : undefined)}>
      {icon ? <SymbolView name={icon} size={20} tintColor={color} fallback={<View style={styles.iconSpacer} />} /> : null}
      <ThemedText type="smallBold" style={[styles.rowLabel, { color }]}>
        {label}
      </ThemedText>
      {detail ? (
        <ThemedText type="small" themeColor="mutedForeground">
          {detail}
        </ThemedText>
      ) : null}
      {(href || onPress) && !destructive ? (
        <SymbolView
          name="chevron.right"
          size={13}
          tintColor={tokens.mutedForeground}
          fallback={<ThemedText themeColor="mutedForeground">›</ThemedText>}
        />
      ) : null}
    </Pressable>
  );
}

export function SettingsSwitch({
  label,
  help,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  help?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.switchText}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {help ? (
          <ThemedText type="small" themeColor="mutedForeground">
            {help}
          </ThemedText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.one },
  sectionTitle: { paddingHorizontal: Spacing.one, fontSize: 12, letterSpacing: 0.5 },
  card: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, overflow: 'hidden' },
  footer: { paddingHorizontal: Spacing.one, paddingTop: Spacing.half },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    minHeight: 48,
  },
  rowLabel: { flex: 1 },
  switchText: { flex: 1, gap: 2 },
  iconSpacer: { width: 20 },
});
