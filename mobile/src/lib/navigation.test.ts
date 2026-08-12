import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// expo-router's own comparator, not a re-implementation: the point of this test
// is what the router will actually do at runtime.
import { sortRoutes } from 'expo-router/build/sortRoutes';
import { describe, expect, it } from 'vitest';

const APP_DIR = new URL('../app/(app)', import.meta.url).pathname;

/** The two fields `sortRoutes` actually reads off a route node. */
type SortableRoute = { route: string; dynamic: null };

// `sortRoutes` is declared over the full `RouteNode`, but it only ever touches
// `route` and `dynamic`; building the other four fields here would be inventing
// a loadRoute and a children tree that nothing in this test can use.
const compareRoutes = sortRoutes as unknown as (a: SortableRoute, b: SortableRoute) => number;

/**
 * Route names in a tab group, as expo-router derives them from the directory.
 *
 * Subdirectories count. A nested directory is a route node named after the
 * directory, and a *group* directory sorts as index-equivalent (see
 * `landingRoute`) — so leaving directories out would blind this test to the one
 * kind of route that can actually take the stack root away from `index`.
 */
function routesIn(group: string): string[] {
  return readdirSync(join(APP_DIR, group), { withFileTypes: true })
    .filter((e) => (e.isDirectory() ? true : e.name.endsWith('.tsx') && e.name !== '_layout.tsx'))
    .map((e) => (e.isDirectory() ? e.name : e.name.replace(/\.tsx$/, '')));
}

function tabGroups(): string[] {
  return readdirSync(APP_DIR).filter((f) => statSync(join(APP_DIR, f)).isDirectory());
}

/**
 * The route a tab lands on when its trigger is pressed.
 *
 * `NativeTabs.Trigger name="(search)"` points at the *group*, not at a screen,
 * so the group's Stack decides which of its routes is the root. With no
 * `initialRouteName` that decision is expo-router's sort, whose last tiebreaker
 * is filename *length* — so a group holding `search.tsx` and `tag.tsx` lands on
 * `tag`, the detail screen, with none of the params it needs.
 *
 * `index` wins that comparison against any plain filename, but sortRoutes also
 * counts a group route as index-equivalent and then falls back to length, so a
 * nested `(x)/` would win and a five-character `(sub)/` would tie and fall to
 * readdir order. That is what this test is here to catch.
 */
function landingRoute(group: string): string {
  const nodes: SortableRoute[] = routesIn(group).map((route) => ({ route, dynamic: null }));
  return [...nodes].sort(compareRoutes)[0]?.route;
}

describe('tab group landing routes', () => {
  // Named `index` rather than declared through `unstable_settings`, which is
  // enough while every route in a group is a plain file. If one of these ever
  // fails because a nested group took the root, the fix is that group's
  // `unstable_settings.initialRouteName`, not a shorter filename.
  it.each(tabGroups())('%s lands on its index route', (group) => {
    expect(landingRoute(group)).toBe('index');
  });

  it('every tab group has an index route to land on', () => {
    for (const group of tabGroups()) {
      expect(routesIn(group)).toContain('index');
    }
  });
});
