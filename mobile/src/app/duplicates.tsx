import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { enqueueTrash } from '@/lib/cache/mutations';
import { probeServer } from '@/lib/connection';
import { formatSize, idsToTrash, removeIds } from '@/lib/duplicates';
import { fetchDuplicates, trashAsset, type DupAsset } from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';

// Duplicates is a manage surface (like Trash), so it takes the VAULT register.
// It uses native controls throughout: SF Symbols (expo-symbols) for iconography
// and the platform Alert for the destructive keep/trash confirmations. Read +
// resolve only — triggering a scan is a session-only owner-console action, so an
// empty result means "no scan yet / none found", not a mobile gap.
const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

export default function DuplicatesScreen() {
  const tokens = useTokens();
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [groups, setGroups] = useState<DupAsset[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const active = await loadCaptureSettings();
    setSettings(active);
    setLoading(true);
    try {
      setGroups(await fetchDuplicates(active));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load duplicates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const trashMany = useCallback(
    async (ids: string[]) => {
      if (!settings) return;
      const online = (await probeServer(settings.baseURL)) === 'ok';
      for (const id of ids) {
        if (online) {
          try {
            await trashAsset(settings, id);
          } catch {
            await enqueueTrash(id);
          }
        } else {
          await enqueueTrash(id);
        }
      }
      setGroups((prev) => removeIds(prev, ids));
    },
    [settings],
  );

  // A native action dialog for one tapped copy: keep it (trash the rest of its
  // group) or trash just this one. The destructive buttons use the platform's
  // native `destructive` styling.
  function promptForAsset(group: DupAsset[], asset: DupAsset) {
    const others = idsToTrash(group, asset.id);
    Alert.alert(asset.filename, 'What would you like to do with this copy?', [
      {
        text: `Keep this, trash ${others.length} other${others.length === 1 ? '' : 's'}`,
        style: 'destructive',
        onPress: () => void trashMany(others),
      },
      { text: 'Move this to Trash', style: 'destructive', onPress: () => void trashMany([asset.id]) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const renderGroup = ({ item: group }: { item: DupAsset[] }) => (
    <View style={[styles.card, { borderColor: tokens.border, backgroundColor: tokens.card }]}>
      <View style={styles.cardHead}>
        <SymbolView
          name="square.on.square"
          size={16}
          tintColor={tokens.mutedForeground}
          fallback={<ThemedText themeColor="mutedForeground">⧉</ThemedText>}
        />
        <ThemedText type="small" themeColor="mutedForeground" style={heading}>
          {group.length} similar copies
        </ThemedText>
      </View>
      <FlatList
        data={group}
        horizontal
        keyExtractor={(a) => a.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        renderItem={({ item: asset }) => (
          <Pressable style={styles.tile} onPress={() => promptForAsset(group, asset)}>
            <Image
              style={styles.thumb}
              source={
                asset.thumbnail_url && settings
                  ? {
                      uri: `${settings.baseURL}${asset.thumbnail_url}`,
                      headers: { Authorization: `Bearer ${settings.deviceToken}` },
                    }
                  : undefined
              }
              contentFit="cover"
            />
            <ThemedText type="small" themeColor="mutedForeground" style={styles.size}>
              {formatSize(asset.size_bytes)}
            </ThemedText>
          </Pressable>
        )}
      />
    </View>
  );

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <SymbolView
            name="chevron.left"
            size={18}
            tintColor={tokens.foreground}
            fallback={<ThemedText style={heading}>‹</ThemedText>}
          />
          <ThemedText style={heading}>Back</ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={heading}>Duplicates</ThemedText>
        <View style={styles.spacer} />
      </View>

      {loading ? (
        <Center text="Finding duplicates…" />
      ) : error ? (
        <Center text={error} symbol="exclamationmark.triangle" glyph="⚠" tint={tokens.mutedForeground} />
      ) : groups.length === 0 ? (
        <Center
          text="No duplicates found. Run a duplicate scan from the desktop app to check your library."
          symbol="checkmark.circle"
          glyph="✓"
          tint={tokens.mutedForeground}
        />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g[0]?.id ?? Math.random().toString()}
          renderItem={renderGroup}
          contentContainerStyle={styles.list}
        />
      )}
    </ThemedView>
  );
}

function Center({
  text,
  symbol,
  glyph,
  tint,
}: {
  text: string;
  symbol?: string;
  glyph?: string;
  tint?: string;
}) {
  return (
    <View style={styles.center}>
      {symbol ? (
        <SymbolView
          name={symbol as never}
          size={40}
          tintColor={tint}
          fallback={<ThemedText style={styles.glyph}>{glyph}</ThemedText>}
        />
      ) : null}
      <ThemedText themeColor="mutedForeground" style={[heading, styles.centerText]}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  spacer: { width: 60 },
  list: { padding: Spacing.two, gap: Spacing.two },
  card: { borderWidth: 1, borderRadius: 12, padding: Spacing.two, marginBottom: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingBottom: Spacing.one },
  row: { gap: Spacing.one },
  tile: { alignItems: 'center', gap: Spacing.half },
  thumb: { width: 96, height: 96, borderRadius: 8, backgroundColor: '#0002' },
  size: { fontSize: 11 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.two },
  centerText: { textAlign: 'center' },
  glyph: { fontSize: 40 },
});
