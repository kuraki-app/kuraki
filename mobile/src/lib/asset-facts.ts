import { formatBytes } from '@/lib/format';
import type { AssetDetail } from '@/lib/library-api';

/**
 * One row of the details sheet: an icon, the fact, and what the fact is.
 *
 * The secondary line is the label, not the value — "Capture date" under the
 * date, "Resolved on your server" under the place. That inversion is the point
 * of the sheet: the answer is what you read first, and what kind of answer it
 * is comes second. The previous dialog was three unlabelled muted lines, so a
 * date and a file size were typographically indistinguishable.
 */
export type AssetFact = {
  key: 'file' | 'date' | 'camera' | 'place';
  /** SF Symbol name. */
  icon: 'doc' | 'clock' | 'camera' | 'mappin';
  primary: string;
  secondary: string;
};

/** dimensions renders a pixel size, or null when the server has not probed one. */
function dimensions(width: number, height: number): string | null {
  return width > 0 && height > 0 ? `${width} × ${height}` : null;
}

/**
 * assetFacts turns one asset's metadata into the rows the details sheet draws.
 *
 * A row is omitted entirely rather than rendered empty or as "Unknown". A
 * details sheet listing four facts of which two say nothing is worse than one
 * listing two facts: the empty rows read as missing data the user should go and
 * fix, when usually they are simply fields this file never carried.
 *
 * `camera` needs a make or a model; a bare MIME type is not a camera, so a
 * screenshot gets no camera row. `place` needs a resolved city or country —
 * raw coordinates are not a place, and the server's own reverse geocoding is
 * what turns one into the other.
 */
export function assetFacts(asset: AssetDetail): AssetFact[] {
  const facts: AssetFact[] = [];

  const size = asset.size_bytes > 0 ? formatBytes(asset.size_bytes) : null;
  const dims = dimensions(asset.width, asset.height);
  const fileDetail = [size, dims].filter(Boolean).join(' · ');
  facts.push({
    key: 'file',
    icon: 'doc',
    primary: asset.filename,
    // Never empty: an asset with neither a size nor dimensions still has a
    // type, and the file row is the one row that should always be present.
    secondary: fileDetail || asset.mime_type,
  });

  if (asset.taken_at) {
    facts.push({
      key: 'date',
      icon: 'clock',
      primary: formatTaken(asset.taken_at),
      secondary: 'Capture date',
    });
  }

  // Apple writes the make into the model ("Apple" + "Apple iPhone 15"), so
  // joining blindly reads "Apple Apple iPhone 15". When the model already
  // carries the make, the model alone is the whole name.
  const make = asset.camera_make.trim();
  const model = asset.camera_model.trim();
  const camera = !model
    ? make
    : !make || model.toLowerCase().includes(make.toLowerCase())
      ? model
      : `${make} ${model}`;
  if (camera) {
    facts.push({ key: 'camera', icon: 'camera', primary: camera, secondary: asset.mime_type });
  }

  const place = [asset.place_city, asset.place_country].filter(Boolean).join(', ');
  if (place) {
    facts.push({ key: 'place', icon: 'mappin', primary: place, secondary: 'Resolved on your server' });
  }

  return facts;
}

/**
 * formatTaken renders a capture instant as "24 Nov 2024, 07:12".
 *
 * Deliberately not `formatTakenAt` from lib/format: that one is the caption
 * over the photograph and reads as a sentence. This is a data row, so it takes
 * the compact form. An unparseable date returns the raw string rather than
 * "Invalid Date" — the server sent something, and showing it is more useful
 * than hiding that it is malformed.
 */
function formatTaken(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;

  const date = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}
