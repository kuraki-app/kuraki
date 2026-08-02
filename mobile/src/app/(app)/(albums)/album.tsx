import { Stack, useLocalSearchParams } from 'expo-router';

import AlbumDetail from '@/components/album-detail';
import { headerOptions } from '@/components/screen-header';

// A pushed route rather than a component swapped in by AlbumList's local state.
// Being a real screen is what gives the album its back button, the interactive
// back-swipe, and an Android hardware back that closes the album instead of
// leaving the tab.
export default function AlbumRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();

  return (
    <>
      <Stack.Screen
        options={headerOptions({ title: name ?? 'Album', register: 'kura' })}
      />
      <AlbumDetail albumId={id} />
    </>
  );
}
