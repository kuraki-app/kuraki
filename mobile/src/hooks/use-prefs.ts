import { useEffect, useState } from 'react';

import { DEFAULT_PREFS, loadPrefs, onPrefsChange, prefsSnapshot, type Prefs } from '@/lib/prefs';

/**
 * usePrefs reads the preference store and re-renders when it changes.
 *
 * It seeds from the synchronous mirror so a screen that mounts after
 * preferences have already been read paints the right layout immediately,
 * rather than flashing the default three-column grid and then reflowing.
 */
export function usePrefs(): Prefs {
  const [prefs, setPrefs] = useState<Prefs>(() => prefsSnapshot() ?? DEFAULT_PREFS);

  useEffect(() => {
    let cancelled = false;
    // Deferred so the first setState never fires synchronously in the effect.
    const timer = setTimeout(() => {
      void loadPrefs().then((p) => {
        if (!cancelled) setPrefs(p);
      });
    }, 0);
    const unsubscribe = onPrefsChange(() => {
      const next = prefsSnapshot();
      if (next && !cancelled) setPrefs(next);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return prefs;
}
