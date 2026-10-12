import { resolveServerURL } from '@/lib/connection';
import { normalizeServerURL } from '@/lib/url';
import {
  connectionEpoch,
  loadCaptureSettings,
  connectCaptureSettings,
  saveCaptureSettings,
  StaleConnectionError,
} from '@/lib/settings';
import { flushFavorites } from '@/lib/library-api';
import { clearAuthLost } from '@/lib/session';

/** Commit a probed address and reconnect with the authenticated library identity. */
export async function commitServerAddress(input: string) {
  const expectedEpoch = connectionEpoch();
  const stored = await loadCaptureSettings();
  const resolved = await resolveServerURL(input);
  const baseURL = resolved ?? normalizeServerURL(input);
  if (connectionEpoch() !== expectedEpoch) throw new StaleConnectionError();
  let settings;
  if (resolved && stored.deviceToken && stored.baseURL === baseURL)
    settings = await connectCaptureSettings(
      { baseURL, deviceToken: stored.deviceToken },
      undefined,
      expectedEpoch,
    );
  else {
    await saveCaptureSettings(
      { baseURL, deviceToken: stored.deviceToken },
      expectedEpoch,
    );
    settings = await loadCaptureSettings();
  }
  if (resolved && settings.deviceToken) {
    clearAuthLost();
    await flushFavorites(settings);
  }
  return { settings, reachable: !!resolved };
}
