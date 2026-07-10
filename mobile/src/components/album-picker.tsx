import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { backupEngine, type BackupAlbum } from '@/lib/backup-engine';

type Props = {
  selected: string[];
  onClose: () => void;
};

// AlbumPicker lets the user limit automatic backup to specific device albums.
// An empty selection means the whole library, shown as "All photos & videos".
export default function AlbumPicker({ selected, onClose }: Props) {
  const [albums, setAlbums] = useState<BackupAlbum[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(selected));
  const [error, setError] = useState('');

  useEffect(() => {
    void backupEngine
      .listAlbums()
      .then((list) => {
        setAlbums(list);
        if (!list.length) setError('No albums found, or photo access is off.');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load albums.'));
  }, []);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save(ids: string[]) {
    await backupEngine.setAlbums(ids);
    onClose();
  }

  return (
    <ThemedView style={styles.content}>
      <ThemedText type="title">Albums to back up</ThemedText>
      <ThemedText themeColor="textSecondary" selectable>
        Choose which albums back up, or back up everything.
      </ThemedText>

      <Pressable style={styles.row} onPress={() => void save([])}>
        <ThemedText type="smallBold">All photos &amp; videos</ThemedText>
        {selected.length === 0 && <ThemedText themeColor="textSecondary">Current</ThemedText>}
      </Pressable>

      {error ? <ThemedText themeColor="textSecondary" selectable>{error}</ThemedText> : null}

      <ScrollView style={styles.list}>
        {(albums ?? []).map((album) => {
          const on = chosen.has(album.id);
          return (
            <Pressable key={album.id} style={styles.row} onPress={() => toggle(album.id)}>
              <View style={styles.rowText}>
                <ThemedText selectable>{album.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{album.assetCount} items</ThemedText>
              </View>
              <View style={[styles.check, on && styles.checkOn]}>
                {on && <ThemedText type="smallBold" style={styles.tick}>✓</ThemedText>}
              </View>
            </Pressable>
          );
        })}
        {albums === null && !error ? <ThemedText themeColor="textSecondary">Loading albums…</ThemedText> : null}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable style={styles.ghost} onPress={onClose}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable style={styles.button} onPress={() => void save([...chosen])}>
          <ThemedText type="smallBold">
            {chosen.size ? `Back up ${chosen.size} album${chosen.size === 1 ? '' : 's'}` : 'Save'}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: Spacing.three, gap: Spacing.two },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#b8b9be',
  },
  rowText: { flex: 1, gap: Spacing.half },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: '#b8b9be', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#24211f', borderColor: '#24211f' },
  tick: { color: '#fff' },
  actions: { flexDirection: 'row', gap: Spacing.two },
  button: { flex: 1, alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three, backgroundColor: '#cde7f7' },
  ghost: { alignItems: 'center', borderRadius: Spacing.two, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: '#b8b9be' },
});
