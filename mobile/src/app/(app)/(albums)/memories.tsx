import { Stack } from 'expo-router';

import CollectionGrid from '@/components/collection-grid';
import { headerOptions } from '@/components/screen-header';
import { fetchMemories } from '@/lib/library-api';

export default function MemoriesScreen() {
  return (
    <>
      <Stack.Screen options={headerOptions({ title: 'On this day' })} />
      <CollectionGrid loadPage={fetchMemories} emptyMessage="No memories from this day yet." />
    </>
  );
}
