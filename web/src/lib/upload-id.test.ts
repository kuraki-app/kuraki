import { afterEach, expect, test, vi } from 'vitest';
import { uploadId } from './upload-queue';

afterEach(() => vi.unstubAllGlobals());

test('queued files get valid IDs on an ordinary HTTP LAN origin', () => {
  vi.stubGlobal('crypto', {
    getRandomValues: (target: Uint8Array) => {
      target.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return target;
    }
  });
  expect(uploadId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
});
