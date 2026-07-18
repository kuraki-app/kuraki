import { View, type ViewProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'background' | 'card' | 'secondary';
};

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const tokens = useTheme();

  return <View style={[{ backgroundColor: tokens[type ?? 'background'] }, style]} {...otherProps} />;
}
