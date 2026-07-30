import * as SecureStore from 'expo-secure-store';

// AFTER_FIRST_UNLOCK, not the WHEN_UNLOCKED default.
//
// The background backup task reads the server URL and device token on every OS
// wake. iOS schedules those wakes when the device is idle and charging -- i.e.
// overnight, while it is locked. Under WHEN_UNLOCKED the keychain refuses those
// reads, so run() saw a null token, reported "Connect this device in Settings
// first.", and returned Success to the OS: background backup silently never ran
// while locked, behind a misleading diagnostic. AFTER_FIRST_UNLOCK still keeps
// the data encrypted at rest until the first unlock after boot, which is the
// right trade-off for a credential a background task must use.
const accessible = SecureStore.AFTER_FIRST_UNLOCK;

export async function getSecret(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, { keychainAccessible: accessible });
}

export async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

/**
 * rewriteSecretForBackgroundAccess re-saves an existing value under the
 * background-readable accessibility class. A keychain item keeps the
 * accessibility it was written with, so anyone who paired before this change
 * would carry WHEN_UNLOCKED until they re-paired by hand. Re-writing once on
 * launch migrates them in place. Missing keys are left alone.
 */
export async function rewriteSecretForBackgroundAccess(key: string): Promise<void> {
  const existing = await SecureStore.getItemAsync(key);
  if (existing === null) return;
  await SecureStore.setItemAsync(key, existing, { keychainAccessible: accessible });
}
