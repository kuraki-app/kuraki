import { Button, Host, Picker, Text, TextField } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PhotoGrid from '@/components/photo-grid';
import TagList from '@/components/tag-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { setCachedFavorite } from '@/lib/cache/assets';
import { enqueueFavorite, pendingFavorites } from '@/lib/cache/mutations';
import { fetchLibrary, setFavorite, type LibraryAsset } from '@/lib/library-api';
import { SEARCH_CHIPS, searchFilters } from '@/lib/search';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

// The native TextField has no submit callback, so search runs on a debounce
// rather than a return key. That suits search better anyway — results narrow as
// you type instead of after a commit.
const DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState(0);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [tagSheet, setTagSheet] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (active: CaptureSettings | null, chipIndex: number, q: string) => {
    if (!active) return;
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const page = await fetchLibrary(active, searchFilters(chipIndex, q));
      // Same overlay Gallery applies: an un-flushed optimistic favorite must not
      // be visually reverted by the server's older value.
      const pend = await pendingFavorites();
      setAssets(
        pend.size
          ? page.assets.map((a) => (pend.has(a.id) ? { ...a, favorite: pend.get(a.id)! } : a))
          : page.assets,
      );
      setCursor(page.next_cursor);
    } catch (cause) {
      setAssets([]);
      setError(cause instanceof Error ? cause.message : 'Could not search your library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadCaptureSettings().then(setSettings), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  const schedule = useCallback(
    (chipIndex: number, q: string) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void run(settings, chipIndex, q), DEBOUNCE_MS);
    },
    [run, settings],
  );

  function onQueryChange(text: string) {
    setQuery(text);
    schedule(chip, text);
  }

  function onChipChange(index: number) {
    setChip(index);
    // A filter change is a deliberate act, so it applies immediately.
    if (debounce.current) clearTimeout(debounce.current);
    void run(settings, index, query);
  }

  async function loadMore() {
    if (!cursor || !settings || loading) return;
    try {
      const page = await fetchLibrary(settings, searchFilters(chip, query), cursor);
      setAssets((prev) => [...prev, ...page.assets]);
      setCursor(page.next_cursor);
    } catch {
      /* keep what we have */
    }
  }

  const toggleFavorite = useCallback(
    async (id: string, next: boolean) => {
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, favorite: next } : a)));
      await setCachedFavorite(id, next);
      if (settings) {
        try {
          await setFavorite(settings, id, next);
          return;
        } catch {
          // fall through: queue for the next reconnect flush
        }
      }
      await enqueueFavorite(id, next);
    },
    [settings],
  );

  return (
    <ThemedView style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText type="title" style={heading}>
          Search
        </ThemedText>

        <Host matchContents style={styles.field}>
          <TextField
            autoFocus
            placeholder="Search your library"
            onTextChange={onQueryChange}
          />
        </Host>

        <Host matchContents style={styles.picker}>
          <Picker
            modifiers={[pickerStyle('segmented')]}
            selection={chip}
            onSelectionChange={(next) => onChipChange(Number(next))}>
            {SEARCH_CHIPS.map((c, i) => (
              <Text key={c.label} modifiers={[tag(i)]}>
                {c.label}
              </Text>
            ))}
          </Picker>
        </Host>

        <Host matchContents style={styles.tags}>
          <Button systemImage="tag" label="Browse tags" onPress={() => setTagSheet(true)} />
        </Host>
      </View>

      {error ? (
        <View style={styles.center}>
          <ThemedText themeColor="mutedForeground" style={styles.msg} selectable>
            {error}
          </ThemedText>
        </View>
      ) : (
        <PhotoGrid
          assets={assets}
          settings={settings}
          loading={loading}
          onEndReached={() => void loadMore()}
          onToggleFavorite={(id, next) => void toggleFavorite(id, next)}
          emptyMessage={searched ? 'Nothing matched that search.' : 'Search your photos and videos.'}
        />
      )}

      {tagSheet && settings && (
        <TagList
          settings={settings}
          onClose={() => setTagSheet(false)}
          onPressTag={(t) => {
            setTagSheet(false);
            router.push({ pathname: '/(app)/tag', params: { tag: t.id, title: t.name } });
          }}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two },
  field: { minHeight: 44 },
  picker: { minHeight: 36 },
  tags: { alignItems: 'flex-start', minHeight: 36, paddingBottom: Spacing.two },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  msg: { textAlign: 'center' },
});
