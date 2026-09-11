import { StyleSheet, Text, type TextProps } from 'react-native';

import { FontFamily } from '@/design/fonts';
import { designMetrics, type TokenName } from '@/design/tokens';
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
        { color: tokens[themeColor ?? 'foreground'], fontFamily: FontFamily.regular },
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
    fontFamily: FontFamily.medium,
    fontSize: designMetrics.type.label.size,
    lineHeight: designMetrics.type.label.lineHeight,
    fontWeight: 500,
  },
  smallBold: {
    fontFamily: FontFamily.bold,
    fontSize: designMetrics.type.label.size,
    lineHeight: designMetrics.type.label.lineHeight,
    fontWeight: 700,
  },
  default: {
    fontFamily: FontFamily.medium,
    fontSize: designMetrics.type.body.size,
    lineHeight: designMetrics.type.body.lineHeight,
    fontWeight: 500,
  },
  // Phone sizes. These were 48/32, which is a desktop display scale: at 48pt a
  // screen title ate a third of the viewport before any content, and a card
  // heading as short as "Automatic backup" wrapped onto two lines. 28/20 keeps
  // the same visual hierarchy while leaving the screen for content.
  title: {
    fontFamily: FontFamily.semibold,
    fontSize: designMetrics.type.title.size,
    fontWeight: 600,
    lineHeight: designMetrics.type.title.lineHeight,
  },
  subtitle: {
    fontFamily: FontFamily.semibold,
    fontSize: designMetrics.type.subtitle.size,
    lineHeight: designMetrics.type.subtitle.lineHeight,
    fontWeight: 600,
  },
  link: {
    fontFamily: FontFamily.medium,
    lineHeight: 30,
    fontSize: designMetrics.type.label.size,
  },
  linkPrimary: {
    fontFamily: FontFamily.medium,
    lineHeight: 30,
    fontSize: designMetrics.type.label.size,
  },
  code: {
    fontFamily: FontFamily.medium,
    fontSize: designMetrics.type.meta.size,
  },
});
