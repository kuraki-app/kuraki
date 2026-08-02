import { describe, expect, it } from 'vitest';

import { classifyPermission, permissionAction } from '@/lib/permissions';

describe('classifyPermission', () => {
  it('separates iOS limited access from full access', () => {
    // The case the screen exists for: the response says granted, so every
    // ordinary check passes, while the media library returns only the handful
    // of photos the user picked and backup silently skips the rest.
    expect(classifyPermission({ granted: true, canAskAgain: false, accessPrivileges: 'limited' })).toBe(
      'limited',
    );
    expect(classifyPermission({ granted: true, canAskAgain: false, accessPrivileges: 'all' })).toBe(
      'granted',
    );
  });

  it('treats a grant with no accessPrivileges as full access', () => {
    // Android sends no accessPrivileges at all.
    expect(classifyPermission({ granted: true, canAskAgain: true })).toBe('granted');
  });

  it('distinguishes never-asked from permanently refused', () => {
    expect(classifyPermission({ granted: false, canAskAgain: true })).toBe('undetermined');
    expect(classifyPermission({ granted: false, canAskAgain: false })).toBe('denied');
  });

  it('reports a missing native module as unavailable', () => {
    expect(classifyPermission(null)).toBe('unavailable');
  });
});

describe('permissionAction', () => {
  it('offers an in-app prompt only while the OS will still show one', () => {
    expect(permissionAction('undetermined')).toBe('grant');
  });

  it('sends limited and denied to the Settings app', () => {
    // Re-asking for limited access re-opens the photo picker rather than
    // widening access, so an in-app grant button would not fix it.
    expect(permissionAction('limited')).toBe('system');
    expect(permissionAction('denied')).toBe('system');
  });

  it('offers nothing when there is nothing to do', () => {
    expect(permissionAction('granted')).toBe('none');
    expect(permissionAction('unavailable')).toBe('none');
  });
});
