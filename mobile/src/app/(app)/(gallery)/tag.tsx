import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { headerOptions } from '@/components/screen-header';
import TagGrid from '@/components/tag-grid';

// The tag grid as pushed from the Gallery tab's tag sheet. The Search tab has
// its own copy of this route so that tapping a tag there does not throw the
// user into a different tab — see components/tag-grid.tsx.
export default function GalleryTagScreen() {
  const { tag, title } = useLocalSearchParams<{ tag: string; title?: string }>();

  // The same guard the Search tab's copy carries, for the same reason: `tag` is
  // a query param, so a restored navigation state can land here without one.
  // TagGrid bails out of its fetch when the tag is missing but never clears its
  // initial `loading`, so the screen would sit on a spinner under the header
  // "Tag" that resolves to nothing. The gallery is the only sensible place to be.
  if (!tag) return <Redirect href="/(app)/(gallery)" />;

  return (
    <>
      <Stack.Screen
        options={headerOptions({ title: title ?? 'Tag' })}
      />
      <TagGrid tag={tag} />
    </>
  );
}
