import { deleteSecret, getSecret, rewriteSecretForBackgroundAccess, setSecret } from '@/lib/secret-store';

const baseURLKey = 'kuraki.capture.base-url';
const deviceTokenKey = 'kuraki.capture.device-token';

export type CaptureSettings = {
  baseURL: string;
  deviceToken: string;
};

export async function loadCaptureSettings(): Promise<CaptureSettings> {
  const [baseURL, deviceToken] = await Promise.all([getSecret(baseURLKey), getSecret(deviceTokenKey)]);
  return { baseURL: baseURL ?? '', deviceToken: deviceToken ?? '' };
}

/**
 * migrateSecretsForBackgroundAccess re-saves the capture credentials under the
 * background-readable keychain class. A keychain item keeps whatever
 * accessibility it was created with, so devices paired before that change would
 * keep failing every locked-device background wake until re-paired by hand.
 * Idempotent, and a no-op when nothing is stored.
 */
export async function migrateSecretsForBackgroundAccess(): Promise<void> {
  await Promise.all([
    rewriteSecretForBackgroundAccess(baseURLKey),
    rewriteSecretForBackgroundAccess(deviceTokenKey),
  ]);
}

/**
 * switchedLibrary reports whether moving from one set of capture settings to
 * another means the app is now looking at a different library.
 *
 * Both halves matter and neither is sufficient. A changed address is a
 * different server. A changed device token at the same address is a different
 * *account* on it — Kuraki isolates libraries per owner, so re-pairing as
 * someone else swaps the library out from under a mirror that has no idea.
 *
 * First-time values are not a switch: going from nothing to something is
 * setup, and there is no previous library to leave behind. Re-pairing to the
 * same account rotates the token and does count, which discards a cache that
 * would have been correct — an acceptable trade, because re-pairing is rare and
 * the mirror rebuilds itself from the first request, whereas keeping another
 * library's photos is wrong until someone notices.
 */
export function switchedLibrary(previous: CaptureSettings, next: CaptureSettings): boolean {
  const movedServer = previous.baseURL !== '' && previous.baseURL !== next.baseURL;
  const movedAccount =
    previous.deviceToken !== '' && next.deviceToken !== '' && previous.deviceToken !== next.deviceToken;
  return movedServer || movedAccount;
}

export async function saveCaptureSettings(settings: CaptureSettings): Promise<void> {
  const next: CaptureSettings = {
    baseURL: settings.baseURL.trim().replace(/\/+$/, ''),
    deviceToken: settings.deviceToken.trim(),
  };
  const previous = await loadCaptureSettings();

  await Promise.all([setSecret(baseURLKey, next.baseURL), setSecret(deviceTokenKey, next.deviceToken)]);

  // Imported lazily so this module stays free of expo-sqlite: it is imported by
  // the background task, which must not drag the cache layer in to write an
  // address.
  if (switchedLibrary(previous, next)) {
    const { resetMirror } = await import('@/lib/cache/reset');
    await resetMirror();
  }
}

/**
 * clearDeviceToken removes the stored token, but only if it is still the one
 * that failed.
 *
 * The compare is the whole point. A 401 clears the token asynchronously, and
 * nothing ordered that against a re-pair storing a new one — so a rejection
 * that was already in flight when the user paired deleted the credential
 * pairing had just written, leaving a device the server considers active and an
 * app that says "Not paired". Passing the token that actually failed makes the
 * clear a no-op once it has been replaced.
 */
export async function clearDeviceToken(failed?: string): Promise<void> {
  if (failed !== undefined) {
    const current = await getSecret(deviceTokenKey);
    if (current !== failed) return;
  }
  await deleteSecret(deviceTokenKey);
}

const setupCompleteKey = 'kuraki.setup.complete';

// The setup-complete flag is a reactive signal (mirroring session.ts): a
// synchronous mirror lets the persistent root layout seed instantly, and the
// subscription lets it re-read after markSetupComplete()/clearSetupComplete()
// so the onboarding gate does not bounce across a group switch.
type SetupListener = () => void;
const setupListeners = new Set<SetupListener>();
let setupCompleteMirror: boolean | null = null; // null = not yet read from SecureStore

export function setupCompleteSnapshot(): boolean | null {
  return setupCompleteMirror;
}
export function onSetupChange(listener: SetupListener): () => void {
  setupListeners.add(listener);
  return () => setupListeners.delete(listener);
}
function notifySetupChange(): void {
  for (const l of setupListeners) l();
}

export async function isSetupComplete(): Promise<boolean> {
  const complete = (await getSecret(setupCompleteKey)) === '1';
  setupCompleteMirror = complete;
  return complete;
}

export async function markSetupComplete(): Promise<void> {
  await setSecret(setupCompleteKey, '1');
  setupCompleteMirror = true;
  notifySetupChange();
}

export async function clearSetupComplete(): Promise<void> {
  await deleteSecret(setupCompleteKey);
  setupCompleteMirror = false;
  notifySetupChange();
}
