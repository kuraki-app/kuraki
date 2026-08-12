import { Stack } from 'expo-router';

// A stack so the Albums tab gets a native header, and so opening an album can
// be a real push. AlbumDetail used to be swapped in by local state inside
// AlbumList, which meant no back button, no back gesture, and on Android the
// hardware back button left the album instead of closing it.
//
// The list is `index.tsx` for the reason spelled out in (search)/_layout.tsx:
// as `albums.tsx` it lost the stack-root tiebreaker to the shorter `album.tsx`,
// so the tab opened the detail screen with no id. That was survivable only
// because album.tsx redirects when `id` is missing — the tab worked by bouncing
// off a guard meant for hand-typed links, not by landing anywhere on purpose.
export default function AlbumsLayout() {
  return <Stack />;
}
