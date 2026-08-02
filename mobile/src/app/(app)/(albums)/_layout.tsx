import { Stack } from 'expo-router';

// A stack so the Albums tab gets a native header, and so opening an album can
// be a real push. AlbumDetail used to be swapped in by local state inside
// AlbumList, which meant no back button, no back gesture, and on Android the
// hardware back button left the album instead of closing it.
export default function AlbumsLayout() {
  return <Stack />;
}
