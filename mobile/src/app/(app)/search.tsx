import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PhotoGrid from '@/components/photo-grid';
import TagList from '@/components/tag-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { setCachedFavorite } from '@/lib/cache/assets';
import { enqueueFavorite, pendingFavorites } from '@/lib/cache/mutations';
import { fetchLibrary, setFavorite, type LibraryAsset } from '@/lib/library-api';
import { SEARCH_CHIPS, searchFilters } from '@/lib/search';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

// Search owns the query field and the filter chips that used to crowd the top
// of the library screen. It deliberately does not report scrolling to the tab
// bar: the pill stays expanded here, so the way back is always visible.
export default function SearchScreen() {
  const tokens = useTokens();
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

  const run = useCallback(async (active: CaptureSettings | null, chipIndex: number, q: string) => {
    if (!active) return;
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const page = await fetchLibrary(active, searchFilters(chipIndex, q));
      // Same overlay Gallery applies: an un-flushed optimistic favorite must
      // not be visually reverted by the server's older value.
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
    void loadCaptureSettings().then(setSettings);
  }, []);

  function selectChip(index: number) {
    setChip(index);
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
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onChangeText={setQuery}
          onSubmitEditing={() => void run(settings, chip, query)}
          placeholder="Search your library"
          placeholderTextColor={tokens.textFaint}
          returnKeyType="search"
          style={[styles.search, { borderColor: tokens.input, color: tokens.foreground }]}
          value={query}
        />
        <View style={styles.chips}>
          {SEARCH_CHIPS.map((c, i) => (
            <Pressable
              key={c.label}
              onPress={() => selectChip(i)}
              style={[
                styles.chip,
                { borderColor: tokens.input },
                i === chip && { backgroundColor: tokens.primary, borderColor: tokens.primary },
              ]}>
              <ThemedText
                type="small"
                themeColor={i === chip ? 'primaryForeground' : undefined}
                style={heading}>
                {c.label}
              </ThemedText>
            </Pressable>
          ))}
          <Pressable onPress={() => setTagSheet(true)} style={[styles.chip, { borderColor: tokens.input }]}>
            <ThemedText type="small" style={heading}>
              Tags ▾
            </ThemedText>
          </Pressable>
        </View>
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
  header: { padding: Spacing.three, gap: Spacing.two },
  search: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
  },
  chips: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: 999, borderWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  msg: { textAlign: 'center' },
});
