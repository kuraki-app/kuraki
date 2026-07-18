import { describe, expect, it } from 'vitest';
import { classifyMutationResult } from '@/lib/cache/mutations';

describe('classifyMutationResult', () => {
  it('2xx is sent', () => {
    expect(classifyMutationResult(200, false)).toBe('sent');
  });
  it('404 is dropped — the asset is gone server-side', () => {
    expect(classifyMutationResult(404, false)).toBe('drop');
  });
  it('5xx is retried', () => {
    expect(classifyMutationResult(500, false)).toBe('retry');
  });
  it('a network error is retried', () => {
    expect(classifyMutationResult(0, true)).toBe('retry');
  });
  it('401 is retried, not dropped — reconnect will resend', () => {
    expect(classifyMutationResult(401, false)).toBe('retry');
  });
  it('409 is dropped — an already-trashed/not-in-trash conflict cannot succeed on retry', () => {
    expect(classifyMutationResult(409, false)).toBe('drop');
  });
  it('400 is dropped — a bad request cannot succeed on retry', () => {
    expect(classifyMutationResult(400, false)).toBe('drop');
  });
});
