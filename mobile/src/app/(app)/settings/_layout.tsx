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
// `large: true` on the first six and not on the last two is not a style
// choice. A large title relies on the screen's first-descendant scroll view to
// carry its content inset (see screen-header.tsx); those six are a ScrollView
// at the root of the screen, while Trash and Duplicates put their list behind a
// wrapper view, so they take the compact title instead.
export default function SettingsLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={headerOptions({ title: 'Settings', register: 'vault', large: true })}
      />
      <Stack.Screen
        name="backup"
        options={headerOptions({ title: 'Backup', register: 'vault', large: true })}
      />
      <Stack.Screen
        name="connection"
        options={headerOptions({ title: 'Connection', register: 'vault', large: true })}
      />
      <Stack.Screen
        name="activity"
        options={headerOptions({ title: 'Activity', register: 'vault', large: true })}
      />
      <Stack.Screen
        name="notifications"
        options={headerOptions({ title: 'Notifications', register: 'vault', large: true })}
      />
      <Stack.Screen
        name="grid"
        options={headerOptions({ title: 'Photo Grid', register: 'vault', large: true })}
      />
      <Stack.Screen name="trash" options={headerOptions({ title: 'Trash', register: 'vault' })} />
      <Stack.Screen
        name="duplicates"
        options={headerOptions({ title: 'Duplicates', register: 'vault' })}
      />
    </Stack>
  );
}
