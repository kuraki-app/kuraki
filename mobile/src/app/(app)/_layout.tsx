import { Tabs } from 'expo-router';

import AppTabBar from '@/components/app-tab-bar';
import { ScrollReporterProvider } from '@/components/scroll-reporter';

export default function AppLayout() {
  return (
    <ScrollReporterProvider>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
        <Tabs.Screen name="index" options={{ title: 'Gallery' }} />
        <Tabs.Screen name="albums" options={{ title: 'Albums' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
        {/* Reachable by navigation, never drawn as a tab item: search has its
            own button on the right of the bar, and place/tag are detail routes
            pushed from within the other screens. */}
        <Tabs.Screen name="search" options={{ href: null }} />
        <Tabs.Screen name="place" options={{ href: null }} />
        <Tabs.Screen name="tag" options={{ href: null }} />
      </Tabs>
    </ScrollReporterProvider>
  );
}
