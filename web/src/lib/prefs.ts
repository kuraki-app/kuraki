import { writable } from 'svelte/store';

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
