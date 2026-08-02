import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import AlbumList from '@/components/album-list';
import { headerOptions, toolbarGlyph } from '@/components/screen-header';
import { ThemedView } from '@/components/themed-view';
import { useTokens } from '@/constants/theme';

// Albums is its own tab. Its title, its top inset and its create action all
// belong to the native header now: the screen used to draw a bare title under
// `paddingTop: insets.top`, and AlbumList carried a second row beneath it whose
// only content was the "＋" button.
export default function AlbumsScreen() {
  const tokens = useTokens();
  // Owned here rather than inside AlbumList because the button that opens the
  // create sheet lives in the header, which is this screen's to declare.
  const [creating, setCreating] = useState(false);

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={headerOptions({ title: 'Albums' })} />
      {/* A real bar button item rather than a custom view in `headerRight`,
          for the same reason as the Gallery's filter menu: iOS 26 wraps an
          arbitrary header view in a glass disc, and a toolbar item is sized
          and placed by the system like the back chevron opposite it. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          {...toolbarGlyph('plus', 'New')}
          accessibilityLabel="New album"
          tintColor={tokens.foreground}
          hidesSharedBackground
          onPress={() => setCreating(true)}
        />
      </Stack.Toolbar>
      <AlbumList creating={creating} onCreatingChange={setCreating} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
