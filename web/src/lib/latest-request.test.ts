import { describe, expect, it } from 'vitest';
import { latestRequest } from './latest-request';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('replaceable reads', () => {
  it('aborts old work and discards a late response even if the loader ignores cancellation', async () => {
    const requests = latestRequest();
    const old = deferred<string>();
    let signal!: AbortSignal;
    const first = requests.run((s) => { signal = s; return old.promise; });
    expect(await requests.run(async () => 'new filter')).toEqual({ status: 'completed', value: 'new filter' });
    expect(signal.aborted).toBe(true);
    old.resolve('old filter');
    expect(await first).toEqual({ status: 'superseded' });
  });

  it('silences stale failures but reports current failures', async () => {
    const requests = latestRequest();
    const old = deferred<string>();
    const first = requests.run(() => old.promise);
    requests.cancel();
    old.reject(new Error('stale failure'));
    expect(await first).toEqual({ status: 'superseded' });
    await expect(requests.run(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });

  it('a late completion cannot release the newer request during teardown', async () => {
    const requests = latestRequest();
    const old = deferred<string>();
    const next = deferred<string>();
    const first = requests.run(() => old.promise);
    let signal!: AbortSignal;
    const second = requests.run((s) => { signal = s; return next.promise; });
    old.resolve('old');
    await first;
    requests.cancel();
    expect(signal.aborted).toBe(true);
    next.resolve('new');
    expect(await second).toEqual({ status: 'superseded' });
  });
});
