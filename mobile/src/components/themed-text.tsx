import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { FontFamily } from '@/design/fonts';
import type { TokenName } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: TokenName;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const tokens = useTheme();

  return (
    <Text
      style={[
        { color: tokens[themeColor ?? 'foreground'] },
        type === 'default' && styles.default,
        type === 'title' && { ...styles.title, fontFamily: FontFamily.heading },
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && { ...styles.subtitle, fontFamily: FontFamily.heading },
        type === 'link' && styles.link,
        type === 'linkPrimary' && [styles.linkPrimary, { color: tokens.info }],
        type === 'code' && { ...styles.code, fontFamily: FontFamily.mono },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  // Phone sizes. These were 48/32, which is a desktop display scale: at 48pt a
  // screen title ate a third of the viewport before any content, and a card
  // heading as short as "Automatic backup" wrapped onto two lines. 28/20 keeps
  // the same visual hierarchy while leaving the screen for content.
  title: {
    fontSize: 28,
    fontWeight: 600,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
  },
  code: {
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
