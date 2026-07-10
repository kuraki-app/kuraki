import * as SecureStore from 'expo-secure-store';

const baseURLKey = 'kuraki.capture.base-url';
const deviceTokenKey = 'kuraki.capture.device-token';

export type CaptureSettings = {
  baseURL: string;
  deviceToken: string;
};

export async function loadCaptureSettings(): Promise<CaptureSettings> {
  const [baseURL, deviceToken] = await Promise.all([
    SecureStore.getItemAsync(baseURLKey),
    SecureStore.getItemAsync(deviceTokenKey),
  ]);
  return { baseURL: baseURL ?? '', deviceToken: deviceToken ?? '' };
}

export async function saveCaptureSettings(settings: CaptureSettings): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(baseURLKey, settings.baseURL.trim().replace(/\/+$/, '')),
    SecureStore.setItemAsync(deviceTokenKey, settings.deviceToken.trim()),
  ]);
}

/** clearDeviceToken removes the stored token (e.g. after the server revoked it). */
export async function clearDeviceToken(): Promise<void> {
  await SecureStore.deleteItemAsync(deviceTokenKey);
}
