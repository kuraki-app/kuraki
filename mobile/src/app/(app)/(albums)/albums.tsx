import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import AlbumList from '@/components/album-list';
import { HeaderButton, headerOptions } from '@/components/screen-header';
import { ThemedView } from '@/components/themed-view';

// Albums is its own tab. Its title, its top inset and its create action all
// belong to the native header now: the screen used to draw a bare title under
// `paddingTop: insets.top`, and AlbumList carried a second row beneath it whose
// only content was the "＋" button.
export default function AlbumsScreen() {
  // Owned here rather than inside AlbumList because the button that opens the
  // create sheet lives in the header, which is this screen's to declare.
  const [creating, setCreating] = useState(false);

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen
        options={headerOptions({
          title: 'Albums',
          register: 'kura',
          right: () => (
            <HeaderButton
              symbol="plus"
              glyph="＋"
              label="New album"
              onPress={() => setCreating(true)}
            />
          ),
        })}
      />
      <AlbumList creating={creating} onCreatingChange={setCreating} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
