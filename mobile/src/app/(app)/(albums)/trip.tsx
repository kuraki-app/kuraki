import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { headerOptions } from '@/components/screen-header';
import TripGrid from '@/components/trip-grid';

export default function CollectionTripScreen() {
  const { trip, title } = useLocalSearchParams<{ trip: string; title?: string }>();
  if (!trip) return <Redirect href="/(app)/(albums)" />;
  return (
    <>
      <Stack.Screen options={headerOptions({ title: title ?? 'Trip' })} />
      <TripGrid trip={trip} />
    </>
  );
}
