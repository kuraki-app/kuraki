import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from './api';
import { bumpLibrary } from './stores';
import { startSync } from './sync';

vi.mock('./api', () => ({ api: { changes: vi.fn() } }));
vi.mock('./stores', () => ({ bumpLibrary: vi.fn() }));

let values: Map<string, string>;
const stops: Array<() => void> = [];
beforeEach(() => {
  values = new Map();
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('EventSource', undefined);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  vi.mocked(api.changes).mockResolvedValue({ changes: [], cursor: 0, has_more: false });
});
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test('account switches use their own saved cursors rather than the old origin-wide cursor', async () => {
  values.set('kuraki:sync-cursor', '999');
  values.set('kuraki:sync-cursor:a', '25');
  values.set('kuraki:sync-cursor:b', '9');
  stops.push(startSync('a'), startSync('b'));
  await vi.advanceTimersByTimeAsync(0);
  expect(api.changes).toHaveBeenCalledWith(25, undefined, 'a', expect.any(AbortSignal));
  expect(api.changes).toHaveBeenCalledWith(9, undefined, 'b', expect.any(AbortSignal));
});

test('each open tab advances from its own live cursor', async () => {
  values.set('kuraki:sync-cursor:a', '10');
  vi.mocked(api.changes).mockResolvedValue({ changes: [], cursor: 11, has_more: false });
  stops.push(startSync('a'));
  await vi.advanceTimersByTimeAsync(0);
  values.set('kuraki:sync-cursor:a', '999');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(vi.mocked(api.changes).mock.calls.at(-1)?.[0]).toBe(11);
});

test('stopped account responses cannot persist cursors or refresh the new account', async () => {
  let complete: (result: Awaited<ReturnType<typeof api.changes>>) => void = () => {};
  values.set('kuraki:sync-cursor:a', '25');
  vi.mocked(api.changes).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const stop = startSync('a');
  const signal = vi.mocked(api.changes).mock.calls[0][3];
  stop();
  complete({ changes: [], reset: true, cursor: 999, has_more: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(signal?.aborted).toBe(true);
  expect(values.get('kuraki:sync-cursor:a')).toBe('25');
  expect(bumpLibrary).not.toHaveBeenCalled();
});
