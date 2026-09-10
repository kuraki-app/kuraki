import { describe, expect, it } from 'vitest';
import { idsToTrash, removeIds } from './duplicates';
import type { DupAsset } from './library-api';

const a = (id: string): DupAsset => ({ id, filename: `${id}.jpg`, size_bytes: 1000 });

describe('idsToTrash', () => {
  it('returns every member except the kept one', () => {
    expect(idsToTrash([a('1'), a('2'), a('3')], '2')).toEqual(['1', '3']);
  });
  it('never includes the kept id even if it appears', () => {
    expect(idsToTrash([a('1'), a('2')], '1')).toEqual(['2']);
  });
});

describe('removeIds', () => {
  it('drops trashed assets and discards groups left with < 2 members', () => {
    const groups = [
      [a('1'), a('2'), a('3')],
      [a('4'), a('5')],
    ];
    const next = removeIds(groups, ['2', '3', '4']);
    // First group keeps 1 → dropped; second group keeps 5 → dropped.
    expect(next).toEqual([]);
  });
  it('keeps a group that still has two members', () => {
    const next = removeIds([[a('1'), a('2'), a('3')]], ['3']);
    expect(next).toEqual([[a('1'), a('2')]]);
  });
});
