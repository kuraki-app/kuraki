import type { DupAsset } from '@/lib/library-api';

// idsToTrash returns every asset in a duplicate group except the one to keep —
// the set the "keep this one" action sends to trash. Never includes keepId, so
// a mis-tap can't delete the copy the user chose to keep.
export function idsToTrash(group: DupAsset[], keepId: string): string[] {
  return group.filter((a) => a.id !== keepId).map((a) => a.id);
}

// removeIds drops trashed assets from the loaded groups and discards any group
// that no longer has at least two members (nothing left to compare).
export function removeIds(groups: DupAsset[][], ids: string[]): DupAsset[][] {
  const gone = new Set(ids);
  return groups.map((g) => g.filter((a) => !gone.has(a.id))).filter((g) => g.length >= 2);
}

// formatSize renders a byte count as a short human string for the row label.
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const rounded = Math.round(n * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} ${units[i]}`;
}
