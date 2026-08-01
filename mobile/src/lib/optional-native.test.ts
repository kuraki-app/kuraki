import { describe, expect, it, vi } from 'vitest';

import { loadOptionalModule } from '@/lib/optional-native';

describe('loadOptionalModule', () => {
  it('returns the module when it evaluates cleanly', () => {
    expect(loadOptionalModule(() => ({ default: 'map' }))).toEqual({ default: 'map' });
  });

  it('returns null when the module throws while evaluating', () => {
    // What Expo Go actually does: MapLibre's index reaches
    // TurboModuleRegistry.getEnforcing('MLRNCameraModule') at module scope and
    // the binary has no such module, so the require itself throws.
    const load = () => {
      throw new Error(
        "Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'MLRNCameraModule' could not be found.",
      );
    };
    expect(loadOptionalModule(load)).toBeNull();
  });

  it('defers evaluation until called', () => {
    // The whole point: a static import evaluates at route load and takes the
    // route down. This must not touch the module before the caller asks.
    const load = vi.fn(() => ({ default: 'map' }));
    expect(load).not.toHaveBeenCalled();
    loadOptionalModule(load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-Error throw as null too', () => {
    expect(
      loadOptionalModule(() => {
        throw 'string throw';
      }),
    ).toBeNull();
  });
});
