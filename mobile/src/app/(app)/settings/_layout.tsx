import { Stack } from 'expo-router';

// Settings is a stack, not one long scroll: the index lists destinations and
// each subpage pushes. The native header is deliberately switched on here —
// everywhere else in this app draws its own headerless bar, but a settings
// tree is exactly what the platform's large-title header and system back
// button are for, and it also means these screens need no manual top inset.
export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitle: true, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="backup" options={{ title: 'Backup' }} />
      <Stack.Screen name="connection" options={{ title: 'Connection' }} />
      <Stack.Screen name="activity" options={{ title: 'Activity' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="grid" options={{ title: 'Photo Grid' }} />
    </Stack>
  );
}
