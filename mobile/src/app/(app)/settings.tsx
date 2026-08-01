import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BackupPanel from '@/components/backup-panel';
import PairSheet from '@/components/pair-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, useTokens } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import { clearMutations } from '@/lib/cache/mutations';
import { nextConnectionState, probeServer, type ConnectionState } from '@/lib/connection';
import { connectionView, showsCodeInput } from '@/lib/connection-view';
import { flushFavorites } from '@/lib/library-api';
import { clearAuthLost, isAuthLost, onAuthLost } from '@/lib/session';
import {
  clearDeviceToken,
  clearSetupComplete,
  loadCaptureSettings,
  saveCaptureSettings,
} from '@/lib/settings';
import { TAB_BAR_HEIGHT } from '@/lib/tab-bar';
import { normalizeServerURL } from '@/lib/url';

const reg = registerStyle('vault');
const heading = { fontFamily: reg.heading };

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export default function SettingsScreen() {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [baseURL, setBaseURL] = useState('');
  // Held only to answer "is this device paired?" — deliberately never rendered
  // and never passed to a component that could display it.
  const [hasToken, setHasToken] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>(
    isAuthLost() ? 'disconnected' : 'online',
  );
  const [saved, setSaved] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const backupRefresh = useRef<(() => Promise<void>) | null>(null);

  const view = connectionView({ hasToken, connection });

  const reload = useCallback(async () => {
    const settings = await loadCaptureSettings();
    setBaseURL(settings.baseURL);
    setHasToken(Boolean(settings.deviceToken));
    return settings;
  }, []);

  // Deferred a tick (the pattern used by the library and places screens) so the
  // first setState inside reload does not fire synchronously within the effect.
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);

  useEffect(
    () =>
      onAuthLost(() => {
        setConnection((c) => nextConnectionState(c, isAuthLost() ? 'auth-lost' : 'reconnected'));
        void reload();
      }),
    [reload],
  );

  const probe = useCallback(async () => {
    const settings = await loadCaptureSettings();
    if (!settings.baseURL) return;
    const result = await probeServer(settings.baseURL);
    setConnection((c) => nextConnectionState(c, result === 'ok' ? 'probe-ok' : 'probe-unreachable'));
  }, []);

  // Saving the address is not a reconnect until the server actually answers —
  // otherwise a typo would clear the auth-lost banner and flush a queue that
  // has nowhere to go.
  async function saveAddress() {
    const settings = await loadCaptureSettings();
    const url = normalizeServerURL(baseURL);
    await saveCaptureSettings({ baseURL: url, deviceToken: settings.deviceToken });
    setBaseURL(url);
    setSaved(true);
    if (settings.deviceToken && (await probeServer(url)) === 'ok') {
      clearAuthLost();
      setConnection((c) => nextConnectionState(c, 'reconnected'));
      await flushFavorites({ baseURL: url, deviceToken: settings.deviceToken });
    }
  }

  async function onPaired(url: string) {
    setPairing(false);
    setBaseURL(url);
    const settings = await reload();
    clearAuthLost();
    setConnection((c) => nextConnectionState(c, 'reconnected'));
    if (settings.deviceToken) await flushFavorites(settings);
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await backupRefresh.current?.();
      await probe();
    } finally {
      setRefreshing(false);
    }
  }

  async function disconnect() {
    await clearDeviceToken();
    await clearSetupComplete();
    await clearMutations();
    router.replace('/(setup)/welcome');
  }

  const registerRefresh = useCallback((fn: () => Promise<void>) => {
    backupRefresh.current = fn;
  }, []);

  return (
    <ThemedView style={styles.fill}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: TAB_BAR_HEIGHT + insets.bottom + Spacing.three,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
        <ThemedView style={styles.header}>
          <ThemedText type="title" style={heading}>
            Settings
          </ThemedText>
        </ThemedView>

        <BackupPanel registerRefresh={registerRefresh} />

        <ThemedView style={styles.section}>
          <ThemedText type="subtitle" style={heading}>
            Connection
          </ThemedText>

          <ThemedView type="card" style={styles.card}>
            {view === 'connected' && (
              <ThemedText type="smallBold" selectable>
                Connected to {hostOf(baseURL)}
              </ThemedText>
            )}
            {view === 'unreachable' && (
              <>
                <ThemedText type="smallBold" style={{ color: tokens.destructive }}>
                  Can’t reach {hostOf(baseURL)}
                </ThemedText>
                <ThemedText type="small" themeColor="mutedForeground">
                  The pairing is still valid. Check the address below, or that this phone is on the
                  same network.
                </ThemedText>
                <Pressable
                  style={[styles.buttonGhost, { borderColor: tokens.input }]}
                  onPress={() => void probe()}>
                  <ThemedText type="smallBold">Retry</ThemedText>
                </Pressable>
              </>
            )}
            {view === 'disconnected' && (
              <>
                <ThemedText type="smallBold" style={{ color: tokens.destructive }}>
                  This device was disconnected
                </ThemedText>
                <ThemedText type="small" themeColor="mutedForeground">
                  The server revoked its access. Re-pair to resume backup.
                </ThemedText>
              </>
            )}
            {showsCodeInput(view) && (
              <>
                <ThemedText type="smallBold">Not paired</ThemedText>
                <ThemedText type="small" themeColor="mutedForeground">
                  Pair this phone with your Kuraki server to back up and browse your library.
                </ThemedText>
              </>
            )}

            <Pressable
              style={[styles.button, { backgroundColor: tokens.primary }]}
              onPress={() => setPairing(true)}>
              <ThemedText type="smallBold" themeColor="primaryForeground">
                {showsCodeInput(view) ? 'Pair this device' : 'Re-pair this device'}
              </ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedText type="smallBold">Server address</ThemedText>
          <ThemedText type="small" themeColor="mutedForeground">
            Change this if your server moved to a new address.
          </ThemedText>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={(t) => {
              setBaseURL(t);
              setSaved(false);
            }}
            placeholder="http://192.168.1.20:3000"
            placeholderTextColor={tokens.textFaint}
            style={[styles.input, { borderColor: tokens.input, color: tokens.foreground }]}
            value={baseURL}
          />
          <Pressable
            style={[styles.buttonGhost, { borderColor: tokens.input }]}
            onPress={() => void saveAddress()}>
            <ThemedText type="smallBold">Save address</ThemedText>
          </Pressable>
          {saved && (
            <ThemedText type="small" themeColor="mutedForeground" selectable>
              Saved securely on this device.
            </ThemedText>
          )}
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText type="subtitle" style={heading}>
            Library
          </ThemedText>
          <Pressable
            style={[styles.row, { borderColor: tokens.input }]}
            onPress={() => router.push('/trash')}>
            <ThemedText type="smallBold">Trash</ThemedText>
            <ThemedText type="small" themeColor="mutedForeground">
              Restore or delete ›
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.row, { borderColor: tokens.input }]}
            onPress={() => router.push('/duplicates')}>
            <ThemedText type="smallBold">Duplicates</ThemedText>
            <ThemedText type="small" themeColor="mutedForeground">
              Review copies ›
            </ThemedText>
          </Pressable>
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText type="subtitle" style={heading}>
            Danger zone
          </ThemedText>
          <ThemedText type="small" themeColor="mutedForeground" selectable>
            Disconnecting removes this device&rsquo;s pairing and sends it back through setup.
            Backed-up photos on the server are unaffected.
          </ThemedText>
          <Pressable
            style={[styles.buttonGhost, { borderColor: tokens.destructive }]}
            onPress={() => void disconnect()}>
            <ThemedText type="smallBold" style={{ color: tokens.destructive }}>
              Disconnect this device
            </ThemedText>
          </Pressable>
        </ThemedView>
        <View style={styles.spacer} />
      </ScrollView>

      <PairSheet
        visible={pairing}
        baseURL={baseURL}
        onClose={() => setPairing(false)}
        onPaired={(url) => void onPaired(url)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  section: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.two },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  input: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.two,
  },
  button: { alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three },
  buttonGhost: {
    alignItems: 'center',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  spacer: { height: Spacing.three },
});
