import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import { headerOptions } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Space, useTokens } from '@/constants/theme';
import { fetchTags, type Tag } from '@/lib/library-api';
import { loadCaptureSettings } from '@/lib/settings';

export default function CollectionTagsScreen() {
  const tokens = useTokens();
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    void loadCaptureSettings()
      .then(fetchTags)
      .then((items) => setTags([...items].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, []);

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={headerOptions({ title: 'Tags' })} />
      <FlatList
        data={tags}
        keyExtractor={(tag) => tag.id}
        contentInsetAdjustmentBehavior="automatic"
        style={styles.list}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, { borderBottomColor: tokens.border }]}
            onPress={() => router.push({ pathname: '/(app)/(albums)/tag', params: { tag: item.id, title: item.name } })}>
            <ThemedText>{item.name}</ThemedText>
            <ThemedText themeColor="textFaint">›</ThemedText>
          </Pressable>
        )}
        ListEmptyComponent={<ThemedText themeColor="mutedForeground" style={styles.empty}>No tags yet.</ThemedText>}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  content: { paddingHorizontal: Space.three },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  empty: { paddingVertical: Space.six, textAlign: 'center' },
});
