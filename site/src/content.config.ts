import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Docs are Markdown so they stay cheap to write and easy to review in a diff.
// The prose that also belongs in the repo (install, migrate) deliberately stays
// short here and links to the canonical Markdown in the repository root, which
// scripts/check-docs-links.sh already guards — two copies of the same
// instructions drift within one release.
const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** Lower sorts first in the sidebar. */
    order: z.number().default(50)
  })
});

export const collections = { docs };
