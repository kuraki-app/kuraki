import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import SetupStep from '@/components/setup-step';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

export default function WelcomeStep() {
  const tokens = useTokens();

  return (
    <SetupStep>
      <ThemedText type="title" style={heading}>
        Welcome to the Vault
      </ThemedText>
      <ThemedText themeColor="textDim">
        Kuraki backs your photos and videos up to a server you run and own — not someone else&rsquo;s cloud. This
        phone will send new camera roll items straight to it, and nowhere else.
      </ThemedText>
      <ThemedText themeColor="mutedForeground">
        Next we&rsquo;ll point this phone at your server, pair the device, and turn on camera roll access.
      </ThemedText>
      <Pressable
        onPress={() => router.push('/(setup)/server')}
        style={[styles.button, { backgroundColor: tokens.primary }]}>
        <ThemedText type="smallBold" style={{ color: tokens.primaryForeground }}>
          Get started
        </ThemedText>
      </Pressable>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three },
});
