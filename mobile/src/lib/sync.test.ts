import { describe, expect, it } from 'vitest';
import { changeAction } from '@/lib/library-api';

type Entry = Parameters<typeof changeAction>[0];
const entry = (op: string, entity = 'asset'): Entry =>
  ({ id: 1, entity, entity_id: 'a1', op }) as Entry;

describe('changeAction', () => {
  it('create/update refetch', () => {
    expect(changeAction(entry('create'))).toBe('refetch');
    expect(changeAction(entry('update'))).toBe('refetch');
  });
  it('delete removes from the mirror', () => {
    expect(changeAction(entry('delete'))).toBe('remove');
  });
  it('non-asset entities are ignored', () => {
    expect(changeAction(entry('update', 'album'))).toBe('ignore');
  });
  it('unknown ops are treated as refetch (safe: re-reads current truth)', () => {
    // Anything that isn't an explicit delete falls through to a refetch, which
    // reconciles against the server rather than guessing.
    expect(changeAction(entry('rename'))).toBe('refetch');
  });
});
