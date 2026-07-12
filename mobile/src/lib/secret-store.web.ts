// expo-secure-store ships an empty web module, so device tokens live in
// localStorage for the browser preview only. Native keeps SecureStore.

export async function getSecret(key: string): Promise<string | null> {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
}
