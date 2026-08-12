import { Stack } from 'expo-router';

// A stack so the Search tab gets the same native header as every other tab.
//
// The search screen must be `index.tsx`. A tab trigger names the *group*, so
// the stack picks its own root, and with no `initialRouteName` that choice is
// expo-router's route sort — whose last tiebreaker is filename length. While
// the screen was `search.tsx` it lost that tiebreaker to `tag.tsx`, so pressing
// Search opened the tag grid with no tag: a header reading "Tag" over a spinner
// that never resolved.
//
// `index` beats every plain filename, but it is not unconditional: sortRoutes
// treats a *group* route as index-equivalent (`route === 'index' ||
// matchGroupName(route) != null`) and then falls back to length, so a nested
// group directory shorter than `index` — `(x)` — would take the root back, and
// a five-character one would leave it to readdir order. Nothing here nests
// today, and navigation.test.ts fails if something does. If this group ever
// needs a nested group, declare the root with `unstable_settings.initialRouteName`
// instead: sortRoutesWithInitial matches the name before any group or length
// comparison, which is the guarantee a filename alone doesn't give.
export default function SearchLayout() {
  return <Stack />;
}
