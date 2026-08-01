import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

// Onboarding runs headerless, so nothing was keeping its content clear of the
// status bar and Dynamic Island. Insetting here covers all four setup screens
// at once rather than repeating it in each.
export default function SetupLayout() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaView>
  );
}
