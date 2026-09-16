import { writable } from 'svelte/store';

export type TransparencyPreference = 'system' | 'reduced' | 'enabled';
const key = 'kuraki:transparency';

export function parseTransparency(value: unknown): TransparencyPreference {
  return value === 'reduced' || value === 'enabled' ? value : 'system';
}

export function reduceTransparency(preference: TransparencyPreference, systemReduced: boolean): boolean {
  return preference === 'reduced' || (preference === 'system' && systemReduced);
}

export const transparency = writable<TransparencyPreference>('system');

/** One browser lifecycle for persistence, OS changes and other open tabs.
 * Motion preferences are independent of surface transparency. */
export function startTransparency(): () => void {
  const media = window.matchMedia('(prefers-reduced-transparency: reduce)');
  try { transparency.set(parseTransparency(localStorage.getItem(key))); } catch { /* private storage */ }
  let preference: TransparencyPreference = 'system';
  const apply = () => {
    document.documentElement.dataset.transparency = reduceTransparency(preference, media.matches)
      ? 'reduced' : 'enabled';
  };
  const unsubscribe = transparency.subscribe((value) => {
    preference = value;
    apply();
    try { localStorage.setItem(key, value); } catch { /* preference still works this session */ }
  });
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) transparency.set(parseTransparency(event.newValue));
  };
  media.addEventListener('change', apply);
  window.addEventListener('storage', storage);
  return () => {
    unsubscribe();
    media.removeEventListener('change', apply);
    window.removeEventListener('storage', storage);
    delete document.documentElement.dataset.transparency;
  };
}
