import { Stack, useSegments } from 'expo-router';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import SetupProgress from '@/components/setup-progress';
import { useTokens } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { onboardingStep } from '@/lib/onboarding';

// Onboarding runs headerless, so nothing was keeping its content clear of the
// status bar and Dynamic Island. Insetting here covers all four setup screens
// at once rather than repeating it in each. The bottom edge is included too:
// the last button on each step sat on the home indicator.
//
// The keyboard is handled here for the same reason. Two of these four steps are
// a text field and a button in a vertically centred column, and with the
// keyboard up on a small phone the field being typed into was behind it, with
// nothing to scroll. `padding` on iOS and `height` on Android are the
// behaviours that actually work per platform.
export default function SetupLayout() {
  const tokens = useTokens();
  const reduced = useReducedMotion();
  const segments = useSegments();
  const current = onboardingStep(segments[segments.length - 1]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.background }} edges={['top', 'bottom']}>
      <SetupProgress {...current} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: tokens.background },
            animation: reduced ? 'none' : 'fade_from_bottom',
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
