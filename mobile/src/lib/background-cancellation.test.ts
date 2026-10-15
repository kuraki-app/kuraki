import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  task: undefined as undefined | (() => Promise<number>),
  expire: undefined as undefined | (() => void),
  sync: vi.fn(),
  run: vi.fn(),
  stop: vi.fn(),
  removed: vi.fn(),
}));
vi.mock('expo-task-manager', () => ({
  defineTask: (_name: string, task: () => Promise<number>) => {
    h.task = task;
  },
}));
vi.mock('expo-background-task', () => ({
  addExpirationListener: (callback: () => void) => {
    h.expire = callback;
    return { remove: h.removed };
  },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
vi.mock('@/lib/backup-engine', () => ({
  backupEngine: { run: h.run, stop: h.stop },
}));
vi.mock('@/lib/background-sync', () => ({ drainBackgroundSync: h.sync }));
// request only supplies pure cancellation helpers here; avoid native keychain import.
vi.mock('@/lib/request', async () => await import('./cancellation'));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.sync.mockResolvedValue({ ran: true });
  h.run.mockResolvedValue(undefined);
});
it('expiration during sync cancels the entire wake and never starts backup', async () => {
  h.sync.mockImplementation(async (signal: AbortSignal) => {
    h.expire?.();
    expect(signal.aborted).toBe(true);
  });
  await import('./background');
  expect(await h.task?.()).toBe(2);
  expect(h.run).not.toHaveBeenCalled();
  expect(h.removed).toHaveBeenCalledOnce();
});
it('passes one task-owned signal through both sync and backup', async () => {
  await import('./background');
  expect(await h.task?.()).toBe(1);
  expect(h.run).toHaveBeenCalledWith({
    background: true,
    signal: h.sync.mock.calls[0][0],
  });
  expect(h.removed).toHaveBeenCalledOnce();
});

it('releases a task even when native sync never resolves after expiration', async () => {
  h.sync.mockImplementation(() => new Promise(() => {}));
  await import('./background');
  const task = h.task!();
  h.expire?.();
  expect(await task).toBe(2);
  expect(h.run).not.toHaveBeenCalled();
});
