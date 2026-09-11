import { Stack } from 'expo-router';

import CollectionGrid from '@/components/collection-grid';
import { headerOptions } from '@/components/screen-header';
import { fetchLibrary } from '@/lib/library-api';

const loadFavorites = (settings: Parameters<typeof fetchLibrary>[0], cursor?: string) =>
  fetchLibrary(settings, { favorite: true }, cursor);

export default function FavoritesScreen() {
  return (
    <>
      <Stack.Screen options={headerOptions({ title: 'Favorites' })} />
      <CollectionGrid
        loadPage={loadFavorites}
        removeWhenUnfavorited
        emptyMessage="Favorite photos appear here."
      />
    </>
  );
}
