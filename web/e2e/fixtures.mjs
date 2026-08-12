// Generates a deterministic fixture library for the end-to-end suite.
//
// Two properties matter here and both are easy to get wrong:
//
//  1. Every file must be BYTE-DISTINCT. The importer deduplicates on a BLAKE3
//     hash, so forty copies of one image import as ONE asset and every grid,
//     paging and selection assertion downstream passes vacuously against a
//     library of size 1. `internal/httpapi/pagination_test.go` hit this exact
//     trap and solved it the same way (`writeDistinctJPEG`).
//  2. Dates must be CONTROLLED, so timeline grouping is assertable. These PNGs
//     carry no EXIF, which means the importer falls back to the file's mtime
//     (`importer.go:221`, pinned by TestImportFallsBackToFileModTimeWhenMedia-
//     CarriesNoDate). Setting mtime therefore sets `taken_at`, and we can lay
//     the library out across known days, months and years on purpose.
//
// PNG rather than JPEG because a valid PNG can be written with nothing but
// node:zlib — no encoder dependency, no binary blob checked into the repo.

import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([length, typed, crc]);
}

// png renders a solid-colour truecolour image with a distinguishing stripe, so
// two fixtures that share a colour still differ byte-for-byte.
function png(width, height, [r, g, b], seed) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      // The seed perturbs one pixel band, guaranteeing a distinct hash even for
      // two fixtures that were handed the same colour.
      const nudge = y === seed % height && x === seed % width ? 37 : 0;
      raw[p] = (r + nudge) & 0xff;
      raw[p + 1] = (g + nudge) & 0xff;
      raw[p + 2] = (b + nudge) & 0xff;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// The shape of the seeded library, chosen so every grouping mode has something
// to group: several photos per day, several days per month, more than one month
// and more than one year. Kept small — this is a smoke library, not a load test.
export const LIBRARY = [
  // [year, month, day, count]
  [2024, 3, 14, 5],
  [2024, 3, 15, 3],
  [2024, 3, 28, 4],
  [2024, 7, 2, 6],
  [2024, 7, 3, 2],
  [2024, 11, 21, 4],
  [2025, 1, 9, 3],
  [2025, 1, 10, 5],
  [2025, 6, 30, 4]
];

export const EXPECTED_ASSETS = LIBRARY.reduce((n, [, , , count]) => n + count, 0);
export const EXPECTED_DAYS = LIBRARY.length;
export const EXPECTED_MONTHS = new Set(LIBRARY.map(([y, m]) => `${y}-${m}`)).size;
export const EXPECTED_YEARS = new Set(LIBRARY.map(([y]) => y)).size;

const PALETTE = [
  [198, 92, 68],
  [92, 128, 168],
  [140, 58, 43],
  [104, 132, 96],
  [176, 152, 96],
  [88, 88, 104]
];

// writeFixtures fills `dir` with the library described above and returns how
// many files it wrote. Callers assert the importer agrees with that number.
export function writeFixtures(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  let seed = 0;
  for (const [year, month, day, count] of LIBRARY) {
    for (let i = 0; i < count; i++) {
      const name = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}-${i}.png`;
      const file = join(dir, name);
      writeFileSync(file, png(48, 48, PALETTE[seed % PALETTE.length], seed));
      // Midday local time. Midnight would sit on the boundary that the
      // `labelDate` timezone bug lived on, and this fixture set should not be
      // the thing that makes that test pass or fail.
      const taken = new Date(year, month - 1, day, 12, 0, 0);
      utimesSync(file, taken, taken);
      seed++;
    }
  }
  return seed;
}
