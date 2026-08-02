import { Stack, useLocalSearchParams } from 'expo-router';

import { headerOptions } from '@/components/screen-header';
import TagGrid from '@/components/tag-grid';

// The tag grid as pushed from Search's "Browse tags" sheet. Identical to the
// Gallery tab's copy on purpose: a tab stack can only push its own routes, and
// pushing the Gallery's would switch tabs mid-task.
export default function SearchTagScreen() {
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
