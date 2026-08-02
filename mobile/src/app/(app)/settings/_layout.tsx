import { Stack } from 'expo-router';

import { headerOptions } from '@/components/screen-header';

// Settings is a stack, not one long scroll: the index lists destinations and
// each subpage pushes.
//
// Trash and Duplicates live here too. They used to sit at the root of the
// router, outside `(app)` entirely, which meant opening either one covered the
// tab bar and left the user on a screen whose only way out was a hand-drawn
// "Close". As members of this stack they push like every other Library
// destination and get the system back button for free.
//
// Every title goes through `headerOptions`, which is also the app's only header
// definition — so these pages, the Gallery and Albums cannot drift apart.
export default function SettingsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={headerOptions({ title: 'Settings' })} />
      <Stack.Screen name="backup" options={headerOptions({ title: 'Backup' })} />
      <Stack.Screen name="connection" options={headerOptions({ title: 'Connection' })} />
      <Stack.Screen name="activity" options={headerOptions({ title: 'Activity' })} />
      <Stack.Screen name="permissions" options={headerOptions({ title: 'Permissions' })} />
      <Stack.Screen name="notifications" options={headerOptions({ title: 'Notifications' })} />
      <Stack.Screen name="grid" options={headerOptions({ title: 'Photo Grid' })} />
      <Stack.Screen name="trash" options={headerOptions({ title: 'Trash' })} />
      <Stack.Screen name="duplicates" options={headerOptions({ title: 'Duplicates' })} />
    </Stack>
  );
}
