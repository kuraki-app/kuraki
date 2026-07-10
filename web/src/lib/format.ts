import type { Asset } from './types';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function labelDate(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return dateFormatter.format(parsed);
}

export function durationLabel(ms: number): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function placeLabel(asset: Asset): string {
  if (asset.place_city && asset.place_country) return `${asset.place_city}, ${asset.place_country}`;
  return asset.place_city || asset.place_country || '';
}

export type DayGroup = { day: string; items: Asset[] };

export function groupByDay(assets: Asset[]): DayGroup[] {
  const map = new Map<string, Asset[]>();
  for (const asset of assets) {
    const key = asset.taken_day ?? asset.created_at.slice(0, 10);
    const current = map.get(key);
    if (current) current.push(asset);
    else map.set(key, [asset]);
  }
  return [...map.entries()].map(([day, items]) => ({ day, items }));
}
