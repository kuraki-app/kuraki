import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let reduced = true;
let initialized = false;
const listeners = new Set<() => void>();

function publish(next: boolean) {
  if (reduced === next) return;
  reduced = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!initialized) {
    initialized = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(publish);
    // One process-wide native subscription serves every animated row/card.
    AccessibilityInfo.addEventListener('reduceMotionChanged', publish);
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Default to reduced motion until the asynchronous platform preference is
 * known. This avoids playing an entrance or press animation for someone who
 * has explicitly disabled motion during the first frame after launch.
 */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, () => reduced, () => true);
}
