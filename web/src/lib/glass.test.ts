import { describe, expect, it } from 'vitest';
import { parseTransparency, reduceTransparency } from './glass';

describe('transparency preferences', () => {
  it('uses the OS only in system mode; explicit preferences override it', () => {
    expect(reduceTransparency('system', false)).toBe(false);
    expect(reduceTransparency('system', true)).toBe(true);
    expect(reduceTransparency('reduced', false)).toBe(true);
    expect(reduceTransparency('enabled', true)).toBe(false);
  });

  it('falls back to system when storage is absent or from an unknown version', () => {
    expect(parseTransparency(null)).toBe('system');
    expect(parseTransparency('unknown')).toBe('system');
    expect(parseTransparency('reduced')).toBe('reduced');
    expect(parseTransparency('enabled')).toBe('enabled');
  });
});
