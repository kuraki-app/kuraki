import { writable } from 'svelte/store';

import type { Grouping } from './format';

// Shared appearance/library preferences. Theme is intentionally not here —
// mode-watcher owns it (setMode/userPrefersMode) and already prevents the
// wrong-theme flash on load; a second store for the same value would just be
// a second source of truth.

export type GridDensity = 'compact' | 'comfortable' | 'large';

const DENSITY_KEY = 'kuraki:grid-density';
const DEFAULT_VIEW_KEY = 'kuraki:default-view';

function readDensity(): GridDensity {
  if (typeof localStorage === 'undefined') return 'comfortable';
  const saved = localStorage.getItem(DENSITY_KEY);
  return saved === 'compact' || saved === 'comfortable' || saved === 'large' ? saved : 'comfortable';
}

export const gridDensity = writable<GridDensity>(readDensity());
gridDensity.subscribe((value) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(DENSITY_KEY, value);
});

const GROUPING_KEY = 'kuraki:grouping';

function readGrouping(): Grouping {
  if (typeof localStorage === 'undefined') return 'day';
  const saved = localStorage.getItem(GROUPING_KEY);
  // Day stays the default: it is what the timeline has always shown, and a
  // stored value from a future version must degrade to it rather than break
  // the grid.
  return saved === 'month' || saved === 'year' || saved === 'off' || saved === 'day' ? saved : 'day';
}

/** How the timeline splits into headed sections. Mirrors the mobile client's
 *  Photo Grid preference, which had no web counterpart. */
export const grouping = writable<Grouping>(readGrouping());
grouping.subscribe((value) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(GROUPING_KEY, value);
});

function readDefaultView(): string {
  if (typeof localStorage === 'undefined') return '/';
  return localStorage.getItem(DEFAULT_VIEW_KEY) || '/';
}

// The route the app opens to after sign-in. Deliberately not a redirect away
// from "/" — "/" IS the Timeline route (see nav.ts NAV_GROUPS), and
// isActive('/', pathname) there is an exact-equality match, so a redirect
// would make Timeline permanently unreachable and its nav item permanently
// un-highlighted. This value is applied once, in +layout.svelte, right after
// a successful login/setup — never as routing logic.
export const defaultView = writable<string>(readDefaultView());
defaultView.subscribe((value) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(DEFAULT_VIEW_KEY, value);
});
