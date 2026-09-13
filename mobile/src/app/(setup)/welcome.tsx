import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import SetupStep, { SetupButton, SetupCard } from '@/components/setup-step';
import { ThemedText } from '@/components/themed-text';
import { Space, useTokens } from '@/constants/theme';

const FACTS = ['Originals stay untouched', 'Automatic background backup', 'No third-party photo cloud'];

export default function WelcomeStep() {
  const tokens = useTokens();

  return (
    <SetupStep
      eyebrow="Own your library"
      title="Your photos. Your server."
      description="Kuraki backs up your camera roll in original quality to a server you control."
      symbol="lock.shield"
      symbolFallback="K">
      <SetupCard>
        {FACTS.map((label) => (
          <View key={label} style={styles.fact}>
            <View style={[styles.dot, { backgroundColor: tokens.stamp }]} />
            <ThemedText type="small">{label}</ThemedText>
          </View>
        ))}
      </SetupCard>
      <SetupButton label="Get started" onPress={() => router.push('/(setup)/server')} />
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fact: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: Space.two },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
