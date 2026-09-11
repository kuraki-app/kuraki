import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { headerOptions } from '@/components/screen-header';
import TagGrid from '@/components/tag-grid';

export default function CollectionTagScreen() {
  const { tag, title } = useLocalSearchParams<{ tag: string; title?: string }>();
  if (!tag) return <Redirect href="/(app)/(albums)" />;
  return (
    <>
      <Stack.Screen options={headerOptions({ title: title ?? 'Tag' })} />
      <TagGrid tag={tag} />
    </>
  );
}
