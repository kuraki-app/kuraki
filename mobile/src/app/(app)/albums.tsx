import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AlbumList from '@/components/album-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

// Albums was a segment inside the library screen; it is now its own
// destination in the tab bar's pill, so it gets a route of its own.
export default function AlbumsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={[styles.fill, { paddingTop: insets.top }]}>
      <ThemedText type="title" style={[heading, styles.title]}>
        Albums
      </ThemedText>
      <AlbumList />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
});
