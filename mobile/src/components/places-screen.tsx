import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import PhotoViewer from '@/components/photo-viewer';
import PlaceList from '@/components/place-list';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { probeServer } from '@/lib/connection';
import { fetchPlaces, fetchPlacesSummary, type LibraryAsset, type PlaceGroup } from '@/lib/library-api';
import { loadOptionalModule } from '@/lib/optional-native';
import { placesViewState, type PlacePoint } from '@/lib/places';
import type { CaptureSettings } from '@/lib/settings';

// The map is resolved at call time, never statically imported: MapLibre's
// MLRN* TurboModules only exist in a build that compiled its native code, and a
// static import would throw during module evaluation in Expo Go — taking the
// whole Library route down with it (see loadOptionalModule). `typeof import()`
// is a type-level query, erased at compile time, so it keeps the props typed
// without pulling the module in.
const PlacesMap = loadOptionalModule<typeof import('@/components/places-map')>(
  // require, not import: the deferral is the entire point, and Metro only runs
  // the module factory when this arrow is called.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require('@/components/places-map'),
)?.default;

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

// PlacesScreen owns the Places segment's fetch + state and composes the map,
// the place list beneath it, and the viewer. Online-first: it fetches on mount
// and falls back to the connection/empty states via placesViewState.
export default function PlacesScreen({ settings }: { settings: CaptureSettings }) {
  const [points, setPoints] = useState<PlacePoint[]>([]);
  const [groups, setGroups] = useState<PlaceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(true);
  const [viewerIndex, setViewerIndex] = useState(-1);

  // Fetch lives in a callback (not inline in the effect) so a synchronous
  // setState never runs directly in the effect body — the repo's lint gate
  // rejects that (react-hooks/set-state-in-effect).
  const load = useCallback(
    async (isCancelled: () => boolean) => {
      setLoading(true);
      try {
        const [pts, grps] = await Promise.all([fetchPlaces(settings), fetchPlacesSummary(settings)]);
        if (isCancelled()) return;
        setPoints(pts);
        setGroups(grps);
        setReachable(true);
      } catch {
        const state = await probeServer(settings.baseURL);
        if (!isCancelled()) setReachable(state === 'ok');
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [settings],
  );

  // Deferred a tick (matching the Library tab's refresh pattern) so the first
  // setState inside load doesn't fire synchronously within the effect.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => void load(() => cancelled), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  const state = placesViewState({ loading, reachable, count: points.length });

  if (state === 'loading') {
    return <Center text="Loading places…" />;
  }
  if (state === 'offline') {
    return <Center text="Places needs a connection to your server." />;
  }
  if (state === 'empty') {
    return <Center text="No photos with location yet. Import photos that carry GPS to see them here." />;
  }

  // PhotoViewer takes a LibraryAsset[]; PlacePoint is a superset, so points
  // satisfy it directly.
  const viewerAssets = points as LibraryAsset[];

  return (
    // A split, not a map with a sheet floating over it. The list is a sibling
    // that owns its own share of the screen, so nothing it holds can end up
    // underneath the tab bar (see place-list.tsx).
    <View style={styles.fill}>
      <View style={styles.map}>
        {PlacesMap ? (
          <PlacesMap
            points={points}
            onPressPoint={(assetId) => setViewerIndex(points.findIndex((p) => p.id === assetId))}
          />
        ) : (
          // No native map in this binary — degrade to the place list alone
          // rather than an empty Places tab. The list below is fully functional.
          <Center text="The map needs a development build — MapLibre isn’t in this binary. Your places are still listed below." />
        )}
      </View>
      <PlaceList
        groups={groups}
        settings={settings}
        totalLocated={points.length}
        onPressPlace={(g) =>
          router.push({
            pathname: '/(app)/(gallery)/place',
            params: { place_city: g.city, place_country: g.country, title: g.city },
          })
        }
      />
      {viewerIndex >= 0 && (
        <PhotoViewer
          assets={viewerAssets}
          initialIndex={viewerIndex}
          settings={settings}
          onClose={() => setViewerIndex(-1)}
        />
      )}
    </View>
  );
}

function Center({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <ThemedText themeColor="mutedForeground" style={[heading, styles.msg]}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // 3:2 against PlaceList's `flex: 2` — the map is what the segment is for, and
  // the list still shows three or four places without scrolling.
  map: { flex: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  msg: { textAlign: 'center' },
});
