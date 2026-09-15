import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { designMetrics } from '@/design/tokens';

it('keeps every native consumer on the shared spacing scale', () => {
  const root = new URL('..', import.meta.url).pathname;
  function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) && !path.endsWith('.test.ts') ? [path] : [];
    });
  }
  for (const file of files(root)) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/\bSpacing\s*[.,=]/);
    for (const match of source.matchAll(/\bSpace\.(\w+)/g)) {
      expect(designMetrics.spacing, `${file}: ${match[0]}`).toHaveProperty(match[1]);
    }
  }
  const shared = JSON.parse(readFileSync(new URL('../../../design/tokens.json', import.meta.url), 'utf8'));
  expect(designMetrics.spacing).toEqual(shared.metrics.spacing);
});
