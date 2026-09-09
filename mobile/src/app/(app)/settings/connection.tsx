import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import PairSheet from '@/components/pair-sheet';
import { SettingsRow, SettingsSection } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, useTokens } from '@/constants/theme';
import { nextConnectionState, probeServer, resolveServerURL, type ConnectionState } from '@/lib/connection';
import { connectionView, showsCodeInput } from '@/lib/connection-view';
import { flushFavorites } from '@/lib/library-api';
import { clearAuthLost, isAuthLost, onAuthLost } from '@/lib/session';
import { loadCaptureSettings, saveCaptureSettings } from '@/lib/settings';
import { normalizeServerURL } from '@/lib/url';

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export default function ConnectionSettings() {
  const tokens = useTokens();
  // The draft in the text field.
  const [baseURL, setBaseURL] = useState('');
  // The address actually stored, which is what the status line describes. They
  // were one value, so the status followed every keystroke — half-typed input
  // read back as "Connected to 192.168.29.1", and a rejected address left the
  // screen claiming a connection to something that was never saved.
  const [activeURL, setActiveURL] = useState('');
  // Read only to answer "is this device paired?". Never rendered, never passed
  // to a component that could display it — see connection-view.ts.
  const [hasToken, setHasToken] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>(
    isAuthLost() ? 'disconnected' : 'online',
  );
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // What went wrong with the address itself, as opposed to whether the server
  // answered. Malformed input used to have nowhere to go: normalizeServerURL
  // throws, saveAddress did not catch, and the rejection escaped as an unhandled
  // promise while the status line went on claiming the old address was
  // connected.
  const [addressError, setAddressError] = useState('');
  const [pairing, setPairing] = useState(false);

  const view = connectionView({ hasToken, connection });

  const reload = useCallback(async () => {
    const s = await loadCaptureSettings();
    setBaseURL(s.baseURL);
    setActiveURL(s.baseURL);
    setHasToken(Boolean(s.deviceToken));
    return s;
  }, []);

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
    const s = await loadCaptureSettings();
    if (!s.baseURL) return;
    const result = await probeServer(s.baseURL);
    setConnection((c) => nextConnectionState(c, result === 'ok' ? 'probe-ok' : 'probe-unreachable'));
  }, []);

  // Saving an address only counts as a reconnect once the server actually
  // answers — otherwise a typo would clear the disconnected state and flush a
  // queue that has nowhere to go.
  async function saveAddress() {
    setAddressError('');
    setSaving(true);
    try {
      await commitAddress();
    } catch (cause) {
      // normalizeServerURL/serverURLCandidates reject input that is not an
      // address at all. That is a sentence worth showing, not a crash.
      setAddressError(cause instanceof Error ? cause.message : 'That address did not work.');
    } finally {
      setSaving(false);
    }
  }

  async function commitAddress() {
    const s = await loadCaptureSettings();
    // Resolve before storing: a typed domain is HTTPS on 443 and a typed LAN
    // address is HTTP on 3000, and only a probe can tell which one this is. A
    // resolved address is known-reachable, so the reconnect below needs no
    // second probe; nothing answering leaves the stored address alone rather
    // than overwriting a working one with a guess.
    const resolved = await resolveServerURL(baseURL);
    // Nothing answered: still store the best guess, because someone repointing
    // the app at a server that is currently down should not have their typing
    // thrown away. The status line below says it is unreachable.
    const url = resolved ?? normalizeServerURL(baseURL);
    await saveCaptureSettings({ baseURL: url, deviceToken: s.deviceToken });
    setBaseURL(url);
    setActiveURL(url);
    setSaved(true);
    if (!resolved) {
      setConnection((c) => nextConnectionState(c, 'probe-unreachable'));
      return;
    }
    if (s.deviceToken) {
      clearAuthLost();
      setConnection((c) => nextConnectionState(c, 'reconnected'));
      await flushFavorites({ baseURL: url, deviceToken: s.deviceToken });
    }
  }

  async function onPaired(url: string) {
    setPairing(false);
    setBaseURL(url);
    setActiveURL(url);
    const s = await reload();
    clearAuthLost();
    setConnection((c) => nextConnectionState(c, 'reconnected'));
    if (s.deviceToken) await flushFavorites(s);
  }

  const status =
    view === 'connected'
      ? `Connected to ${hostOf(activeURL)}`
      : view === 'unreachable'
        ? `Can’t reach ${hostOf(activeURL)}`
        : view === 'disconnected'
          ? 'This device was disconnected'
          : 'Not paired';

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={[styles.fill, { backgroundColor: tokens.background }]}
        contentContainerStyle={styles.content}>
        <SettingsSection
          title="Server address"
          footer="Change this if your server moved to a new address. Use its address on your network, not localhost.">
          <View style={styles.field}>
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
              disabled={saving}
              style={[styles.button, { backgroundColor: tokens.primary }]}
              onPress={() => void saveAddress()}>
              <ThemedText type="smallBold" themeColor="primaryForeground">
                {saving ? 'Checking…' : saved ? 'Saved' : 'Save address'}
              </ThemedText>
            </Pressable>
            {addressError ? (
              <ThemedText type="small" themeColor="destructive">
                {addressError}
              </ThemedText>
            ) : null}
          </View>
        </SettingsSection>

        <SettingsSection title="Status">
          <View style={styles.statusRow}>
            <ThemedText
              type="smallBold"
              style={{ color: view === 'connected' ? tokens.foreground : tokens.destructive }}>
              {status}
            </ThemedText>
            {view === 'unreachable' ? (
              <Pressable onPress={() => void probe()} hitSlop={8}>
                <ThemedText type="smallBold" themeColor="mutedForeground">
                  Retry
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </SettingsSection>

        <SettingsSection
          title="Pairing"
          footer={
            showsCodeInput(view)
              ? 'Pair this phone with your Kuraki server to back up and browse your library.'
              : 'Re-pairing replaces this device’s credentials. Your backed-up photos are unaffected.'
          }>
          <SettingsRow
            label={showsCodeInput(view) ? 'Pair this device' : 'Re-pair this device'}
            icon="qrcode.viewfinder"
            onPress={() => setPairing(true)}
          />
        </SettingsSection>
      </ScrollView>

      <PairSheet
        visible={pairing}
        baseURL={baseURL}
        onClose={() => setPairing(false)}
        onPaired={(url) => void onPaired(url)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: Spacing.five },
  field: { paddingVertical: Spacing.two, gap: Spacing.two },
  input: {
    borderRadius: Radius.sm,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.two,
  },
  button: { alignItems: 'center', borderRadius: Radius.sm, padding: Spacing.three },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.two },
});
