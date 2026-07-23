import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import PhotoViewer from '@/components/photo-viewer';
import PlaceList from '@/components/place-list';
import PlacesMap from '@/components/places-map';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { probeServer } from '@/lib/connection';
import { fetchPlaces, fetchPlacesSummary, type LibraryAsset, type PlaceGroup } from '@/lib/library-api';
import { placesViewState, type PlacePoint } from '@/lib/places';
import type { CaptureSettings } from '@/lib/settings';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

// PlacesScreen owns the Places segment's fetch + state and composes the map,
// the bottom-sheet place list, and the viewer. Online-first: it fetches on
// mount and falls back to the connection/empty states via placesViewState.
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
    <View style={styles.fill}>
      <PlacesMap
        points={points}
        onPressPoint={(assetId) => setViewerIndex(points.findIndex((p) => p.id === assetId))}
      />
      <PlaceList
        groups={groups}
        settings={settings}
        totalLocated={points.length}
        onPressPlace={(g) =>
          router.push({
            pathname: '/(app)/place',
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  msg: { textAlign: 'center' },
});
