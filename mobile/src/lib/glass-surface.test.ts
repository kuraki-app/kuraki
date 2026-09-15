import { describe, expect, it } from 'vitest';

import { resolveGlassSurface, transparencyPreference } from './glass-surface';
import { mergePrefs } from './prefs';

const device = {
  platform: 'ios', version: 26, liquidGlassAvailable: true,
  reduceTransparency: false, preference: 'system' as const, hasBlurTarget: false,
};

describe('surface materials', () => {
  it('uses iOS glass only when both the OS and runtime support it', () => {
    expect(resolveGlassSurface(device)).toBe('glass');
    expect(resolveGlassSurface({ ...device, version: 18 })).toBe('blur');
    expect(resolveGlassSurface({ ...device, liquidGlassAvailable: false })).toBe('blur');
  });

  it('uses Android blur only on API 31+ and with a local target', () => {
    expect(resolveGlassSurface({ ...device, platform: 'android', version: 31, hasBlurTarget: true })).toBe('blur');
    expect(resolveGlassSurface({ ...device, platform: 'android', version: 30, hasBlurTarget: true })).toBe('opaque');
    expect(resolveGlassSurface({ ...device, platform: 'android', version: 35 })).toBe('opaque');
    expect(resolveGlassSurface({ ...device, platform: 'web' })).toBe('opaque');
  });

  it('respects reduced transparency even when effects are explicitly enabled', () => {
    for (const preference of ['system', 'reduced', 'enabled'] as const) {
      expect(resolveGlassSurface({ ...device, preference, reduceTransparency: true })).toBe('opaque');
    }
    expect(resolveGlassSurface({ ...device, preference: 'reduced' })).toBe('opaque');
    expect(resolveGlassSurface({ ...device, preference: 'enabled' })).toBe('glass');
  });

  it('migrates absent and invalid preferences to system', () => {
    for (const value of [undefined, null, true, 'invalid']) {
      expect(transparencyPreference(value)).toBe('system');
      expect(mergePrefs({ transparency: value, gridColumns: 4 }).transparency).toBe('system');
    }
    for (const value of ['system', 'reduced', 'enabled']) {
      expect(mergePrefs({ transparency: value }).transparency).toBe(value);
    }
  });
});
