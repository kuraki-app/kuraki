import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

// Opaque until the iOS preference is known. Android has no equivalent RN
// accessibility API; its local preference and platform capability still apply.
let reduced = Platform.OS === 'ios';
let initialized = false;
const listeners = new Set<() => void>();

function publish(next: boolean) {
  if (reduced === next) return;
  reduced = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!initialized && Platform.OS === 'ios') {
    initialized = true;
    AccessibilityInfo.addEventListener('reduceTransparencyChanged', publish);
    void AccessibilityInfo.isReduceTransparencyEnabled().then(publish).catch(() => publish(true));
  }
  return () => { listeners.delete(listener); };
}

/** Separate from Reduce Motion: disabling travel does not disable material. */
export function useReducedTransparency() {
  return useSyncExternalStore(subscribe, () => reduced, () => true);
}
