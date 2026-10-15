import { expect, it } from 'vitest';
import { orderedLibraryWork } from './operations';
it('releases a canceled library lane even if underlying native work never resolves', async () => {
  const database = {};
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const first = orderedLibraryWork(
    database,
    () => {
      entered();
      return new Promise(() => {});
    },
    controller.signal,
  );
  const failed = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await started;
  const next = orderedLibraryWork(database, async () => 42);
  controller.abort();
  await failed;
  expect(await next).toBe(42);
});
it('allows different libraries to progress while one is busy', async () => {
  const controller = new AbortController();
  const pending = orderedLibraryWork(
    {},
    () => new Promise(() => {}),
    controller.signal,
  );
  const failed = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(await orderedLibraryWork({}, async () => 42)).toBe(42);
  controller.abort();
  await failed;
});
