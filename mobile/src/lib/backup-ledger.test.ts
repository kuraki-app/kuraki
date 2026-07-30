import { describe, expect, it } from 'vitest';

import { canResume, type ResumableUpload } from './backup-ledger';

const stored = (over: Partial<ResumableUpload> = {}): ResumableUpload => ({
  sessionId: 'sess-1',
  sizeBytes: 1_000,
  offsetBytes: 400,
  ...over,
});

describe('canResume', () => {
  it('resumes a partial upload of the same file', () => {
    expect(canResume(stored(), 1_000)).toBe(true);
  });

  it('does not resume when there is no stored session', () => {
    expect(canResume(null, 1_000)).toBe(false);
  });

  it('does not resume when the file size changed', () => {
    // A different size means different bytes: the asset was edited or replaced
    // and the server's partial upload belongs to something else. Resuming would
    // splice two files together.
    expect(canResume(stored(), 2_000)).toBe(false);
  });

  it('does not resume from a zero offset', () => {
    // Nothing was transferred, so a fresh session is equivalent and simpler.
    expect(canResume(stored({ offsetBytes: 0 }), 1_000)).toBe(false);
  });

  it('does not resume from a complete offset', () => {
    expect(canResume(stored({ offsetBytes: 1_000 }), 1_000)).toBe(false);
  });

  it('does not resume from an impossible offset past the end', () => {
    expect(canResume(stored({ offsetBytes: 1_500 }), 1_000)).toBe(false);
  });

  it('does not resume from a negative offset', () => {
    expect(canResume(stored({ offsetBytes: -1 }), 1_000)).toBe(false);
  });
});
