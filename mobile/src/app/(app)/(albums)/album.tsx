import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import AlbumDetail, { type SelectionReport } from '@/components/album-detail';
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
  // Reported up by AlbumDetail, which owns the selection itself. The header is
  // the route's, so the count and the toolbar swap have to be decided here.
  const [selection, setSelection] = useState<SelectionReport>(null);

  // `id` is a query param, not a path segment, so it is not guaranteed to
  // survive everything that can land on this route -- a restored navigation
  // state or a hand-typed link can arrive with none. Without this the screen
  // asked for `/api/albums/undefined` and showed the server's 404 under the
  // fallback title "Album", which reads as "your album is broken" rather than
  // "there is no album here". The album list is the only sensible place to be.
  if (!id) return <Redirect href="/(app)/(albums)" />;

  return (
    <>
      {/* The title stays the album's, even while selecting: the count lives in
          the selection header's left item, and swapping the title as well would
          make leaving selection look like navigating somewhere else. */}
      <Stack.Screen options={headerOptions({ title: name ?? 'Album' })} />
      {/* Adding photos from inside the album was the missing direction: until
          now the only way in was to select photos in the Gallery and choose a
          target album, which is no help when you are looking at the album and
          know what is missing from it.
          Stood down while selecting: the selection's own toolbar takes the same
          slot, and adding photos is not something to do to a selection. */}
      {selection == null && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            {...toolbarGlyph('plus', 'Add')}
            accessibilityLabel="Add photos to this album"
            tintColor={tokens.foreground}
            hidesSharedBackground
            onPress={() => setAdding(true)}
          />
        </Stack.Toolbar>
      )}
      <AlbumDetail
        albumId={id}
        adding={adding}
        onAddingChange={setAdding}
        onSelectionChange={setSelection}
      />
    </>
  );
}
