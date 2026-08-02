import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import AlbumDetail from '@/components/album-detail';
import { headerOptions, toolbarGlyph } from '@/components/screen-header';
import { useTokens } from '@/constants/theme';

// A pushed route rather than a component swapped in by AlbumList's local state.
// Being a real screen is what gives the album its back button, the interactive
// back-swipe, and an Android hardware back that closes the album instead of
// leaving the tab.
export default function AlbumRoute() {
  const tokens = useTokens();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  // Owned here because the button that opens the picker is a toolbar item,
  // which belongs to the route rather than to the album body.
  const [adding, setAdding] = useState(false);

  return (
    <>
      <Stack.Screen options={headerOptions({ title: name ?? 'Album' })} />
      {/* Adding photos from inside the album was the missing direction: until
          now the only way in was to select photos in the Gallery and choose a
          target album, which is no help when you are looking at the album and
          know what is missing from it. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          {...toolbarGlyph('plus', 'Add')}
          accessibilityLabel="Add photos to this album"
          tintColor={tokens.foreground}
          hidesSharedBackground
          onPress={() => setAdding(true)}
        />
      </Stack.Toolbar>
      <AlbumDetail albumId={id} adding={adding} onAddingChange={setAdding} />
    </>
  );
}
