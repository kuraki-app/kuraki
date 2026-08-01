// A few screens lean on third-party native modules that only exist in a custom
// dev/preview build. MapLibre (Places) is the one we have: its package index
// reaches `TurboModuleRegistry.getEnforcing('MLRNCameraModule')` at module
// scope, which throws in any binary that wasn't built with the native code —
// Expo Go, or a dev client built before the dependency was added.
//
// A static `import` of such a package is evaluated when the route that
// transitively reaches it loads, so that throw escapes before the route's own
// `export default` is ever assigned. The route then fails with the misleading
// "missing the required default export", and one optional feature takes down a
// whole screen. React error boundaries cannot help: the module never got far
// enough to render anything.
//
// loadOptionalModule defers the require to call time and turns that module-eval
// throw into a null, so the caller decides what an absent feature looks like.
export function loadOptionalModule<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}
