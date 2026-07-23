import { Camera, type CameraRef, GeoJSONSource, Layer, Map, type GeoJSONSourceRef } from '@maplibre/maplibre-react-native';
import { useMemo, useRef } from 'react';
import { useColorScheme } from 'react-native';

import { mapStyleForScheme } from '@/design/map-style';
import { buildPlacesGeoJSON, type PlacePoint } from '@/lib/places';

type Props = {
  points: PlacePoint[];
  onPressPoint: (assetId: string) => void;
};

// Kuraki's oxblood --stamp, hard-coded here because the native map layers take
// plain colour strings, not our RN token objects.
const STAMP = '#8a1c1c';

// PlacesMap draws located assets as a clustered MapLibre (v11) source: cluster
// count bubbles + plain point dots, no thumbnails on the map (5000 authed
// images as native markers would be a perf + Bearer-header nightmare).
// Thumbnails live in the place list sheet instead.
export default function PlacesMap({ points, onPressPoint }: Props) {
  const scheme = useColorScheme();
  const mapStyle = mapStyleForScheme(scheme);
  const shape = useMemo(() => buildPlacesGeoJSON(points), [points]);
  const sourceRef = useRef<GeoJSONSourceRef>(null);
  const cameraRef = useRef<CameraRef>(null);

  return (
    <Map style={{ flex: 1 }} mapStyle={mapStyle}>
      <Camera ref={cameraRef} center={[0, 20]} zoom={1} />
      <GeoJSONSource
        ref={sourceRef}
        id="places"
        data={shape}
        cluster
        clusterRadius={48}
        clusterMaxZoom={14}
        onPress={async (event) => {
          const feature = event.nativeEvent.features?.[0];
          if (!feature) return;
          const props = feature.properties ?? {};
          // A cluster feature carries `cluster: true` + a numeric `cluster_id`;
          // expand it to the zoom where it splits and recenter there.
          if (props.cluster) {
            const zoom = await sourceRef.current?.getClusterExpansionZoom(props.cluster_id as number);
            const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
            cameraRef.current?.setStop({ center: [lon, lat], zoom: (zoom ?? 8) + 0.5, duration: 500 });
            return;
          }
          const assetId = props.assetId as string | undefined;
          if (assetId) onPressPoint(assetId);
        }}>
        <Layer
          id="places-clusters"
          type="circle"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': STAMP,
            'circle-opacity': 0.85,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-radius': ['step', ['get', 'point_count'], 16, 25, 22, 100, 28],
          }}
        />
        <Layer
          id="places-cluster-count"
          type="symbol"
          filter={['has', 'point_count']}
          layout={{ 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 }}
          paint={{ 'text-color': '#ffffff' }}
        />
        <Layer
          id="places-point"
          type="circle"
          filter={['!', ['has', 'point_count']]}
          paint={{
            'circle-color': STAMP,
            'circle-radius': 6,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          }}
        />
      </GeoJSONSource>
    </Map>
  );
}
