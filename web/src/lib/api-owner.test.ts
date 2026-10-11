import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const model = vi.hoisted(() => {
  const state: { user: { id: string; username: string; role: 'admin' | 'user' } | null } = {
    user: { id: 'a', username: 'Alice', role: 'user' }
  };
  return state;
});

vi.mock('./stores', () => ({
  session: {
    subscribe: (run: (state: { user: typeof model.user }) => void) => { run({ user: model.user }); return () => {}; },
    update: (run: (state: { user: typeof model.user }) => { user: typeof model.user }) => { model.user = run({ user: model.user }).user; }
  }
}));

import { api } from './api';

beforeEach(() => { model.user = { id: 'a', username: 'Alice', role: 'user' }; });
afterEach(() => vi.unstubAllGlobals());

test('authenticated requests bind their expected account at the transport', async () => {
  const send = vi.fn(async (_url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get('X-Kuraki-Owner-ID')).toBe('a');
    return Response.json({ assets: [], next_cursor: '' });
  });
  vi.stubGlobal('fetch', send);
  await api.assets();
  expect(send).toHaveBeenCalledOnce();
});

test('a delayed response cannot expose a previous account or sign out the new one', async () => {
  let complete: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })));
  const response = api.assets();
  model.user = { id: 'b', username: 'Bob', role: 'user' };
  complete(Response.json({ error: 'unauthorized' }, { status: 401 }));
  await expect(response).rejects.toThrow('account_changed');
  expect(model.user.id).toBe('b');
});

test('a changed browser cookie clears the stale account view', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'account_changed' }, { status: 403 })));
  await expect(api.assets()).rejects.toThrow('account_changed');
  expect(model.user).toBeNull();
});
