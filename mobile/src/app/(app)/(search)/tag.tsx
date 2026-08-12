import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { headerOptions } from '@/components/screen-header';
import TagGrid from '@/components/tag-grid';

// The tag grid as pushed from Search's "Browse tags" sheet. Identical to the
// Gallery tab's copy on purpose: a tab stack can only push its own routes, and
// pushing the Gallery's would switch tabs mid-task.
export default function SearchTagScreen() {
  const { tag, title } = useLocalSearchParams<{ tag: string; title?: string }>();

  // The same guard album.tsx carries, for the same reason: `tag` is a query
  // param, so a restored navigation state can land here without one. TagGrid
  // bails out of its fetch when the tag is missing but never clears its initial
  // `loading`, so the screen would sit on a spinner that resolves to nothing.
  // Search is the only sensible place to be.
  if (!tag) return <Redirect href="/(app)/(search)" />;

  return (
    <>
      <Stack.Screen
        options={headerOptions({ title: title ?? 'Tag' })}
      />
      <TagGrid tag={tag} />
    </>
  );
}
