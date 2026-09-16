import type { Action } from 'svelte/action';

export type GlassVariant = 'navigation' | 'overlay' | 'floating';

/** Selective surface treatment without wrapping or changing native semantics.
 * app.css owns tint, support detection and the opaque accessibility fallback.
 * Headless UI primitives use the same data-glass attribute through their props. */
export const glassSurface: Action<HTMLElement, GlassVariant> = (node, variant) => {
  node.dataset.glass = variant;
  return {
    update(next) { node.dataset.glass = next; },
    destroy() { delete node.dataset.glass; }
  };
};
