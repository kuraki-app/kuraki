import { abortable, throwIfAborted } from '@/lib/cancellation';
import {
  deleteSecret,
  getSecret,
  rewriteSecretForBackgroundAccess,
  setSecret,
} from '@/lib/secret-store';

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const baseURLKey = 'kuraki.capture.base-url';
const deviceTokenKey = 'kuraki.capture.device-token';
const connectionKey = 'kuraki.capture.connection.v2';

export type CaptureSettings = {
  baseURL: string;
  deviceToken: string;
  serverID?: string;
  ownerID?: string;
};
let serial: Promise<unknown> = Promise.resolve();
let epoch = 0;
let committed: CaptureSettings | null = null;
export function captureSettingsSnapshot(): CaptureSettings | null {
  return committed;
}
const connectionListeners = new Set<() => void>();
export function connectionEpoch(): number {
  return epoch;
}
export function onCaptureSettingsChange(listener: () => void): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}
function publishConnection(current: CaptureSettings): void {
  committed = { ...current };
  epoch++;
  for (const listener of connectionListeners) listener();
}
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = serial.then(operation);
  serial = result.catch(() => {});
  return result;
}
function clean(settings: CaptureSettings): CaptureSettings {
  const baseURL = settings.baseURL.trim().replace(/\/+$/, '');
  if (baseURL) {
    const url = new URL(baseURL);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'Enter an HTTP or HTTPS server address without credentials or query parameters.',
      );
    }
  }
  return {
    baseURL,
    deviceToken: settings.deviceToken.trim(),
    ...(settings.serverID && settings.ownerID
      ? { serverID: settings.serverID, ownerID: settings.ownerID }
      : {}),
  };
}
async function readConnection(): Promise<CaptureSettings> {
  const raw = await getSecret(connectionKey);
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('baseURL' in parsed) ||
      !('deviceToken' in parsed) ||
      typeof parsed.baseURL !== 'string' ||
      typeof parsed.deviceToken !== 'string'
    )
      throw new Error(
        'Connection settings could not be read. Reconnect this device.',
      );
    const ids = parsed as { serverID?: unknown; ownerID?: unknown };
    return clean({
      baseURL: parsed.baseURL,
      deviceToken: parsed.deviceToken,
      ...(typeof ids.serverID === 'string' && typeof ids.ownerID === 'string'
        ? { serverID: ids.serverID, ownerID: ids.ownerID }
        : {}),
    });
  }
  const [baseURL, deviceToken] = await Promise.all([
    getSecret(baseURLKey),
    getSecret(deviceTokenKey),
  ]);
  return clean({ baseURL: baseURL ?? '', deviceToken: deviceToken ?? '' });
}
export async function loadCaptureSettings(): Promise<CaptureSettings> {
  return readConnection();
}
export function libraryKey(s: CaptureSettings): string {
  // Verified ownership survives token rotation. Unverified/legacy credentials
  // get a private namespace, never ownership of legacy unscoped databases.
  const identity =
    s.serverID && s.ownerID
      ? [s.baseURL, s.serverID, s.ownerID]
      : [s.baseURL, 'unverified', s.deviceToken];
  return bytesToHex(blake3(utf8ToBytes(JSON.stringify(identity))));
}
export function sameConnection(
  a: CaptureSettings,
  b: CaptureSettings,
): boolean {
  return (
    a.baseURL === b.baseURL &&
    a.deviceToken === b.deviceToken &&
    libraryKey(a) === libraryKey(b)
  );
}
export class StaleConnectionError extends Error {
  constructor() {
    super('The connected library changed.');
    this.name = 'StaleConnectionError';
  }
}
export async function assertActiveConnection(
  settings: CaptureSettings,
): Promise<void> {
  if (!sameConnection(await readConnection(), settings))
    throw new StaleConnectionError();
}
// Cache writes and credential commits share this narrow queue. HTTP and media
// work never hold it, so a slow request cannot delay switching libraries.
export function withActiveConnection<T>(
  settings: CaptureSettings,
  write: () => Promise<T>,
): Promise<T> {
  return serialized(async () => {
    await assertActiveConnection(settings);
    return write();
  });
}
export function switchedLibrary(
  previous: CaptureSettings,
  next: CaptureSettings,
): boolean {
  return !!previous.baseURL && libraryKey(previous) !== libraryKey(next);
}
export async function saveCaptureSettings(
  settings: CaptureSettings,
  expectedEpoch?: number,
  signal?: AbortSignal,
): Promise<void> {
  const next = clean(settings);
  await serialized(async () => {
    if (expectedEpoch !== undefined && epoch !== expectedEpoch)
      throw new StaleConnectionError();
    const previous = await readConnection();
    // Keep authenticated identity only when these are exactly the same
    // credentials. New pairings resolve identity before activation.
    if (
      !next.serverID &&
      previous.baseURL === next.baseURL &&
      previous.deviceToken === next.deviceToken
    ) {
      next.serverID = previous.serverID;
      next.ownerID = previous.ownerID;
    }
    if (signal?.aborted)
      throw Object.assign(new Error('Connection canceled.'), {
        name: 'AbortError',
      });
    await setSecret(connectionKey, JSON.stringify(next));
    if (!sameConnection(previous, next)) publishConnection(next);
  });
}
export async function clearDeviceToken(
  failed?: string | CaptureSettings,
  onCleared?: () => void,
): Promise<boolean> {
  return serialized(async () => {
    const current = await readConnection();
    if (
      failed !== undefined &&
      (typeof failed === 'string'
        ? current.deviceToken !== failed
        : !sameConnection(current, failed))
    )
      return false;
    await setSecret(
      connectionKey,
      JSON.stringify({ ...current, deviceToken: '' }),
    );
    // Remove legacy credentials so fallback/migration can never resurrect them.
    await deleteSecret(deviceTokenKey);
    publishConnection({ ...current, deviceToken: '' });
    onCleared?.();
    return true;
  });
}
export async function migrateSecretsForBackgroundAccess(): Promise<void> {
  await serialized(async () => {
    for (const key of [baseURLKey, deviceTokenKey, connectionKey])
      await rewriteSecretForBackgroundAccess(key);
  });
}

/** Resolve authenticated identity before activating newly paired credentials. */
export async function connectCaptureSettings(
  settings: CaptureSettings,
  signal?: AbortSignal,
  expectedEpoch = connectionEpoch(),
): Promise<CaptureSettings> {
  const next = clean(settings);
  if (!next.deviceToken) {
    await saveCaptureSettings(next, expectedEpoch, signal);
    return next;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 8_000);
  try {
    if (signal?.aborted) abort();
    const response = await abortable(
      fetch(`${next.baseURL}/api/capture/identity`, {
        headers: { Authorization: `Bearer ${next.deviceToken}` },
        signal: controller.signal,
      }),
      controller.signal,
    );
    if (response.status !== 404) {
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'Pair this device with the selected server.'
            : 'Could not verify the connected library.',
        );
      const body = (await abortable(response.json(), controller.signal)) as {
        server_id?: unknown;
        owner_id?: unknown;
      };
      if (
        typeof body.server_id !== 'string' ||
        !body.server_id ||
        typeof body.owner_id !== 'string' ||
        !body.owner_id
      )
        throw new Error('Server returned an invalid library identity.');
      next.serverID = body.server_id;
      next.ownerID = body.owner_id;
    }
    throwIfAborted(controller.signal);
    await saveCaptureSettings(next, expectedEpoch, signal);
    return next;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
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

/** Explicit recovery action; never silently discard credentials on a read error. */
export async function resetCaptureConnection(): Promise<void> {
  await serialized(async () => {
    const empty = { baseURL: '', deviceToken: '' };
    await setSecret(connectionKey, JSON.stringify(empty));
    await deleteSecret(baseURLKey);
    await deleteSecret(deviceTokenKey);
    publishConnection(empty);
  });
}
