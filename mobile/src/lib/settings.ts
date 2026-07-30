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

export async function saveCaptureSettings(settings: CaptureSettings): Promise<void> {
  await Promise.all([
    setSecret(baseURLKey, settings.baseURL.trim().replace(/\/+$/, '')),
    setSecret(deviceTokenKey, settings.deviceToken.trim()),
  ]);
}

/** clearDeviceToken removes the stored token (e.g. after the server revoked it). */
export async function clearDeviceToken(): Promise<void> {
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
