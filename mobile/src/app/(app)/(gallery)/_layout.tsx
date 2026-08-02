import { Stack } from 'expo-router';

// The Gallery tab is a stack, not a bare screen.
//
// NativeTabs draws no header of its own, so a tab whose screen sits directly
// under it can only have a header the screen paints itself -- which is what
// every surface here used to do, each with its own `paddingTop: insets.top`.
// Wrapping the tab in a Stack hands the header back to the platform, and it is
// also what lets `place` and `tag` push *inside* the tab: they keep the tab bar
// and get the system back button and the interactive back gesture, neither of
// which their hand-drawn `‹ Back` bar could offer.
//
// The group parentheses keep the URLs unchanged -- this screen is still
// `/(app)/`, not `/(app)/gallery/`.
export default function GalleryLayout() {
  return <Stack />;
}
