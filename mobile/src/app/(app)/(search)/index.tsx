import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import PhotoGrid from '@/components/photo-grid';
import { headerOptions } from '@/components/screen-header';
import TagList from '@/components/tag-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { setCachedFavorite } from '@/lib/cache/assets';
import { enqueueFavorite, pendingFavorites } from '@/lib/cache/mutations';
import { fetchLibrary, setFavorite, type LibraryAsset } from '@/lib/library-api';
import { SEARCH_CHIPS, searchFilters } from '@/lib/search';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

// Search runs on a debounce rather than on a return key, so results narrow as
// you type instead of after a commit.
const DEBOUNCE_MS = 300;

/**
 * The query field is the navigation bar's own search bar, and the filter row is
 * a real segmented control. Both are native on both platforms, and neither is
 * `@expo/ui/swift-ui`.
 *
 * That distinction is the whole history of this screen. It was first built on
 * `@expo/ui/swift-ui` — a `Host`-wrapped SwiftUI `TextField`, `Picker` and
 * `Button`, the only screen in the app importing that module. It is iOS-only,
 * and Kuraki ships an Android APK, where it left search completely inert:
 * Android's `TextFieldView` emits `onValueChange` while the swift-ui wrapper
 * listens for `onTextChange`, so every keystroke was swallowed and the debounce
 * never armed; and `PickerView` is not registered on Android at all. Neither
 * `tsc` nor `expo lint` can see that — the types come from the swift-ui build
 * and are valid on both platforms — so `platform-parity.test.ts` guards it.
 *
 * `@expo/ui/community/segmented-control` is the same idea done properly: it
 * ships `SegmentedControl.ios.tsx` and `SegmentedControl.android.tsx` and picks
 * one per platform, so the split is the library's problem rather than ours.
 *
 * Putting the field in the header also settles the layout argument this screen
 * kept losing. Every Kuraki header is `headerTransparent`, so body content runs
 * underneath it; a text field rendered in the body either underlapped the bar
 * or scrolled up through the title. In the navigation bar it *is* the bar, so
 * there is nothing left to collide with — which is why the title is empty here.
 */
export default function SearchScreen() {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [query, setQuery] = useState('');
  // The debounced mirror of `query` is what actually drives the request, so the
  // fetch is a plain effect over (settings, chip, query) rather than a timer
  // that captures them. That matters beyond tidiness: the old timer closed over
  // `settings`, and a query typed before `loadCaptureSettings` resolved was
  // dropped with nothing to retry it. As a dependency it simply re-runs.
  const [debounced, setDebounced] = useState('');
  const [chip, setChip] = useState(0);
  // Until the user touches something there is nothing to search for, and an
  // empty query would fetch the plain timeline — which is the Gallery tab's job.
  const [touched, setTouched] = useState(false);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tagSheet, setTagSheet] = useState(false);

  useEffect(() => {
    let live = true;
    void loadCaptureSettings().then((s) => {
      if (live) setSettings(s);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!settings || !touched) return;
    // A superseded request must not land on top of a newer one: the cleanup
    // flips `live` before the next effect run, so a slow earlier page is
    // discarded rather than overwriting what the user is now looking at.
    let live = true;
    // Every state write happens inside this callback rather than in the effect
    // body: the fetch is the external system the effect subscribes to, and
    // react-hooks/set-state-in-effect rejects the synchronous form outright.
    const search = async () => {
      setLoading(true);
      setError('');
      try {
        const page = await fetchLibrary(settings, searchFilters(chip, debounced));
        // Same overlay Gallery applies: an un-flushed optimistic favorite must
        // not be visually reverted by the server's older value.
        const pend = await pendingFavorites();
        if (!live) return;
        setAssets(
          pend.size
            ? page.assets.map((a) => (pend.has(a.id) ? { ...a, favorite: pend.get(a.id)! } : a))
            : page.assets,
        );
        setCursor(page.next_cursor);
      } catch (cause) {
        if (!live) return;
        setAssets([]);
        // The cursor belonged to the search that just failed; leaving it set
        // would page the *previous* query's results into this one's grid.
        setCursor(undefined);
        setError(cause instanceof Error ? cause.message : 'Could not search your library.');
      } finally {
        if (live) setLoading(false);
      }
    };
    void search();
    return () => {
      live = false;
    };
  }, [settings, chip, debounced, touched]);

  function onQueryChange(text: string) {
    setQuery(text);
    setTouched(true);
  }

  function onChipChange(index: number) {
    setChip(index);
    setTouched(true);
    // A filter change is a deliberate act, so it applies to whatever has already
    // been typed rather than waiting out the query's debounce.
    setDebounced(query);
  }

  async function loadMore() {
    if (!cursor || !settings || loading) return;
    try {
      // `debounced`, not `query`: the next page must extend the search that
      // produced this one, not a query still being typed.
      const page = await fetchLibrary(settings, searchFilters(chip, debounced), cursor);
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

  // The controls ride inside the grid's list rather than sitting above it. Every
  // Kuraki header is `headerTransparent`, so a sibling View here would start at
  // y=0 and underlap the bar — which is exactly what happened: the chips drew on
  // top of the word "Search" and the text field went up behind the status bar.
  // Only a scroll view gets the platform's automatic inset, so the controls go
  // in the scroll view. See the `listHeader` note in photo-grid.tsx.
  const controls = (
    <View style={styles.header}>
      <SegmentedControl
        style={styles.segments}
        values={SEARCH_CHIPS.map((c) => c.label)}
        selectedIndex={chip}
        onChange={(e) => onChipChange(e.nativeEvent.selectedSegmentIndex)}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Browse tags"
        hitSlop={8}
        style={styles.tags}
        onPress={() => setTagSheet(true)}>
        <ThemedText type="smallBold" themeColor="ring">
          Browse tags
        </ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen
        options={{
          // Empty title, but the header stays. The `(search)` tab is declared
          // `role="search"` (see (app)/_layout.tsx), so on iOS 26 the system
          // lifts this search bar out of the navigation bar and renders it in
          // the tab bar instead — which makes the header look redundant. It is
          // not: `headerShown: false` takes `headerSearchBarOptions` down with
          // it, and the field disappears from the tab bar too, leaving the
          // screen with no way to enter a query at all. Verified on device.
          ...headerOptions({ title: '' }),
          headerSearchBarOptions: {
            placeholder: 'Search your library',
            autoCapitalize: 'none',
            // Otherwise iOS parks the bar off-screen until the list is pulled
            // down, which on a screen whose only purpose is search reads as the
            // field having gone missing.
            hideWhenScrolling: false,
            // No barTintColor/tintColor on purpose. The system draws this field
            // in the tab bar's own material at the tab bar's own height; tinting
            // it from the palette made it read as a separate control sitting in
            // the bar rather than part of it.

            // The native bar is uncontrolled; `query` mirrors it rather than
            // driving it, so its own clear and cancel buttons stay authoritative.
            onChangeText: (e) => onQueryChange(e.nativeEvent.text),
            onCancelButtonPress: () => onQueryChange(''),
          },
        }}
      />
      <PhotoGrid
        assets={assets}
        settings={settings}
        loading={loading}
        listHeader={controls}
        onEndReached={() => void loadMore()}
        onToggleFavorite={(id, next) => void toggleFavorite(id, next)}
        // A failed request reads as the grid's empty state rather than
        // replacing the grid: swapping the whole body out for the error took
        // the search field with it, leaving "Connect this device in Settings
        // first." on screen with no way to retry the query that produced it.
        emptyMessage={
          error || (touched ? 'Nothing matched that search.' : 'Search your photos and videos.')
        }
      />

      {tagSheet && settings && (
        <TagList
          settings={settings}
          onClose={() => setTagSheet(false)}
          onPressTag={(t) => {
            setTagSheet(false);
            router.push({ pathname: '/(app)/(search)/tag', params: { tag: t.id, title: t.name } });
          }}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two },
  // An explicit height rather than leaving it to the control's own measurement.
  // It hosts a SwiftUI picker on iOS, and a host that reports a collapsed height
  // is exactly how this screen's controls ended up stacked on one line before.
  segments: { height: 32 },
  tags: { alignSelf: 'flex-start', paddingBottom: Spacing.two },
});
