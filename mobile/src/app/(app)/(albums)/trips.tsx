import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { headerOptions } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Space, useTokens } from '@/constants/theme';
import { fetchTrips, type Trip } from '@/lib/library-api';
import { loadCaptureSettings } from '@/lib/settings';
import { tripSubtitle, tripTitle } from '@/lib/trips';

export default function CollectionTripsScreen() {
  const tokens = useTokens();
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    void loadCaptureSettings()
      .then(fetchTrips)
      // Newest first, matching the server's own order and the timeline's.
      .then((items) => setTrips(items.filter((t) => !t.hidden)))
      .catch(() => {});
  }, []);

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={headerOptions({ title: 'Trips' })} />
      <FlatList
        data={trips}
        keyExtractor={(trip) => trip.id}
        contentInsetAdjustmentBehavior="automatic"
        style={styles.list}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => {
          const subtitle = tripSubtitle(item);
          return (
            <Pressable
              style={[styles.row, { borderBottomColor: tokens.border }]}
              onPress={() =>
                router.push({
                  pathname: '/(app)/(albums)/trip',
                  params: { trip: item.id, title: tripTitle(item) },
                })
              }>
              <View style={styles.text}>
                <ThemedText numberOfLines={1}>{tripTitle(item)}</ThemedText>
                {/* Dropped entirely rather than rendered blank when the server
                    sent a range that could not be read. */}
                {subtitle ? (
                  <ThemedText themeColor="textFaint" type="small">
                    {subtitle} · {item.asset_count}
                  </ThemedText>
                ) : (
                  <ThemedText themeColor="textFaint" type="small">
                    {item.asset_count}
                  </ThemedText>
                )}
              </View>
              <ThemedText themeColor="textFaint">›</ThemedText>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <ThemedText themeColor="mutedForeground" style={styles.empty}>
            No trips yet. They appear once your library holds photos taken away from home.
          </ThemedText>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  content: { paddingHorizontal: Space.three },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.two,
    paddingVertical: Space.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  empty: { paddingVertical: Space.six, textAlign: 'center' },
});
