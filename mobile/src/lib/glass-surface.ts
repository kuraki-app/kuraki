export type TransparencyPreference = 'system' | 'reduced' | 'enabled';
export type GlassVariant = 'navigation' | 'overlay' | 'floating';
export type SurfaceMaterial = 'opaque' | 'glass' | 'blur';

export function transparencyPreference(value: unknown): TransparencyPreference {
  return value === 'reduced' || value === 'enabled' ? value : 'system';
}

/** Accessibility always wins, including over an explicit effects preference.
 * Android needs a target in the same native window; a dialog in another window
 * uses an opaque surface unless its caller provides a local scene. */
export function resolveGlassSurface({
  platform, version, liquidGlassAvailable, reduceTransparency, preference, hasBlurTarget,
}: {
  platform: string;
  version: number;
  liquidGlassAvailable: boolean;
  reduceTransparency: boolean;
  preference: TransparencyPreference;
  hasBlurTarget: boolean;
}): SurfaceMaterial {
  if (reduceTransparency || preference === 'reduced') return 'opaque';
  if (platform === 'ios') return version >= 26 && liquidGlassAvailable ? 'glass' : 'blur';
  if (platform === 'android' && version >= 31 && hasBlurTarget) return 'blur';
  return 'opaque';
}
