import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { FontFamily } from '@/design/fonts';

// The shared vocabulary of the settings tree: a titled section, a grouped card,
// a row that pushes to a subpage, and a row carrying a switch. Every settings
// screen is built from these so spacing, dividers and hit targets stay
// identical across six pages instead of drifting per file.
//
// Settings is a Vault surface, and these primitives are where that is decided:
// the section label is cased Geist Mono, a row's *value* is Geist Mono (it is
// data) while its *label* is the platform sans (it is prose), and rows are
// separated by a hairline inset past the icon column rather than floating in an
// undifferentiated card. Before this the labels were 14pt bold and the values
// were the same sans as the labels, so a row read as two competing headings
// with no indication which half was the setting and which was its state.

/** The icon column: a 22pt glyph plus the gap to the label. */
const ICON_COLUMN = 22 + Spacing.two;

type SectionInfo = { title?: string; message: string };

export function SettingsSection({
  title,
  info,
  footer,
  children,
}: {
  title?: string;
  info?: SectionInfo;
  footer?: string;
  children: ReactNode;
}) {
  const tokens = useTokens();
  // Dividers belong between rows, not on them: a row cannot know whether it is
  // last, and a trailing hairline against the card's own edge draws a double
  // line. Rendering them here is the only place that knows the run.
  const rows = Children.toArray(children).filter(isValidElement);

  return (
    <View style={styles.section}>
      {title ? (
        <View style={styles.sectionHead}>
          <ThemedText style={[styles.sectionTitle, { fontFamily: FontFamily.mono, color: tokens.textFaint }]}>
            {title.toUpperCase()}
          </ThemedText>
          {info ? <InfoButton title={info.title ?? title} message={info.message} /> : null}
        </View>
      ) : null}
      <ThemedView type="card" style={[styles.card, { borderColor: tokens.border }]}>
        {rows.map((row, index) => (
          <Fragment key={row.key ?? index}>
            {index > 0 ? <View style={[styles.divider, { backgroundColor: tokens.border }]} /> : null}
            {row}
          </Fragment>
        ))}
      </ThemedView>
      {footer ? (
        <ThemedText type="small" themeColor="mutedForeground" style={styles.footer}>
          {footer}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Keep optional explanations one tap away instead of filling every page. */
export function InfoButton({ title, message }: { title: string; message: string }) {
  const tokens = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`About ${title}`}
      hitSlop={10}
      onPress={() => Alert.alert(title, message)}>
      <SymbolView
        name="info.circle"
        size={17}
        tintColor={tokens.mutedForeground}
        fallback={<ThemedText themeColor="mutedForeground">ⓘ</ThemedText>}
      />
    </Pressable>
  );
}

export function SettingsNotice({
  message,
  tone = 'info',
}: {
  message: string;
  tone?: 'info' | 'warning' | 'error';
}) {
  const tokens = useTokens();
  const tint = tone === 'error' ? tokens.destructive : tone === 'warning' ? tokens.warn : tokens.mutedForeground;
  const symbol: SFSymbol = tone === 'error' ? 'xmark.circle' : tone === 'warning' ? 'exclamationmark.triangle' : 'info.circle';

  return (
    <View style={[styles.notice, { borderColor: tokens.border, backgroundColor: tokens.secondary }]}>
      <SymbolView
        name={symbol}
        size={18}
        tintColor={tint}
        fallback={<ThemedText style={{ color: tint }}>!</ThemedText>}
      />
      <ThemedText type="small" style={styles.noticeText} selectable>
        {message}
      </ThemedText>
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
      {icon ? (
        <SymbolView name={icon} size={22} tintColor={tokens.mutedForeground} fallback={<View style={styles.iconSpacer} />} />
      ) : null}
      <ThemedText style={[styles.rowLabel, { color }]} numberOfLines={1}>
        {label}
      </ThemedText>
      {detail ? (
        <ThemedText
          numberOfLines={1}
          style={[styles.rowDetail, { fontFamily: FontFamily.mono, color: tokens.textFaint }]}>
          {detail}
        </ThemedText>
      ) : null}
      {(href || onPress) && !destructive ? (
        <SymbolView
          name="chevron.right"
          size={14}
          tintColor={tokens.textFaint}
          fallback={<ThemedText themeColor="textFaint">›</ThemedText>}
        />
      ) : null}
    </Pressable>
  );
}

// No per-row help text: the explanation belongs to the section, one tap behind
// its info button, rather than repeated under every switch.
export function SettingsSwitch({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.switchText}>
        <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.one },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.one },
  sectionTitle: { fontSize: 11, lineHeight: 17, fontWeight: '600', letterSpacing: 1.4 },
  // A hairline border rather than a shadow — Vault panels are drawn, not lifted.
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    overflow: 'hidden',
  },
  // Inset past the icon column so the rule starts under the label, which is
  // what makes a run of rows read as a list rather than a stack of boxes.
  divider: { height: StyleSheet.hairlineWidth, marginLeft: ICON_COLUMN },
  footer: { paddingHorizontal: Spacing.one, paddingTop: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    minHeight: 56,
  },
  // 16pt regular: the setting's name is prose, and at 14 bold it was competing
  // with the section heading above it.
  rowLabel: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '400' },
  // Mono, and allowed to shrink before the label does — a truncated value is
  // recoverable by opening the row, a truncated label is not.
  rowDetail: { fontSize: 13, lineHeight: 18, flexShrink: 1, textAlign: 'right' },
  switchText: { flex: 1, gap: 2 },
  iconSpacer: { width: 22 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeText: { flex: 1 },
});
