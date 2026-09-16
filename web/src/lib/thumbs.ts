import type { Asset } from '$lib/types';

/**
 * thumbSrcset turns the server's thumbnail tiers into an `<img srcset>`. The
 * medium descriptor is nominal (the server's default 512): the browser only
 * needs the ordering to pick a tier for the tile's rendered width.
 */
export function thumbSrcset(asset: Pick<Asset, 'thumbnail_urls'>): string | undefined {
  const urls = asset.thumbnail_urls;
  if (!urls) return undefined;
  return `${urls.s} 256w, ${urls.m} 512w, ${urls.l} 1200w`;
}
