import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import Dialog from '@/components/dialog';
import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { enqueueSetTags } from '@/lib/cache/mutations';
import { probeServer } from '@/lib/connection';
import { createTag, fetchAssetTags, fetchTags, setAssetTags, type LibraryAsset, type Tag } from '@/lib/library-api';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

// TagEditor is the per-asset tag dialog opened from the viewer. It shows every
// tag with a checkbox, seeded from the asset's current tags. "Done" writes the
// full desired set (the server has no add/remove) — online it PUTs immediately,
// offline it queues a set_tags mutation. Creating a new tag is online-only.
export default function TagEditor({
  asset,
  settings,
  onClose,
}: {
  asset: LibraryAsset;
  settings: CaptureSettings;
  onClose: () => void;
}) {
  const tokens = useTokens();
  const [all, setAll] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTags(settings), fetchAssetTags(settings, asset.id)])
      .then(([tags, assetTags]) => {
        if (cancelled) return;
        setAll(tags);
        setSelected(new Set(assetTags.map((t) => t.id)));
      })
      .catch(() => {
        if (!cancelled) setError('Could not load tags.');
      });
    return () => {
      cancelled = true;
    };
  }, [settings, asset.id]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    const ids = [...selected];
    const state = await probeServer(settings.baseURL);
    if (state === 'ok') await setAssetTags(settings, asset.id, ids);
    else await enqueueSetTags(asset.id, ids);
    onClose();
  }

  async function addNew() {
    const name = draft.trim();
    if (!name) return;
    try {
      const tag = await createTag(settings, name); // online-only
      setAll((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setSelected((prev) => new Set(prev).add(tag.id));
      setDraft('');
    } catch {
      setError('Connect to your server to create a tag.');
    }
  }

  return (
    // Done is the header action rather than a row inside the body: it commits
    // the whole set, so it belongs beside the title and not below a list that
    // scrolls it out of reach.
    <Dialog visible title="Tags" onClose={onClose} action={{ label: 'Done', onPress: () => void apply() }}>
      <View style={styles.createRow}>
        <TextInput
          placeholder="New tag"
          placeholderTextColor={tokens.textFaint}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void addNew()}
          style={[styles.input, { borderColor: tokens.input, color: tokens.foreground }]}
          autoCapitalize="none"
        />
      </View>
      {error ? (
        <ThemedText type="small" themeColor="mutedForeground" style={styles.err}>{error}</ThemedText>
      ) : null}
      <FlatList
        data={all}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable style={styles.row} onPress={() => toggle(item.id)}>
              <ThemedText style={heading}>{on ? '☑' : '☐'}  {item.name}</ThemedText>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="mutedForeground" style={styles.err}>
            No tags yet — create one above.
          </ThemedText>
        }
      />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  createRow: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.one },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
  },
  row: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  err: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.half },
});
