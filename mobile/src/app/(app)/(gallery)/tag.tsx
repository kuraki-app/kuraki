import { Stack, useLocalSearchParams } from 'expo-router';

import { headerOptions } from '@/components/screen-header';
import TagGrid from '@/components/tag-grid';

// The tag grid as pushed from the Gallery tab's tag sheet. The Search tab has
// its own copy of this route so that tapping a tag there does not throw the
// user into a different tab — see components/tag-grid.tsx.
export default function GalleryTagScreen() {
  const { tag, title } = useLocalSearchParams<{ tag: string; title?: string }>();

  return (
    <>
      <Stack.Screen
        options={headerOptions({ title: title ?? 'Tag' })}
      />
      <TagGrid tag={tag} />
    </>
  );
}
