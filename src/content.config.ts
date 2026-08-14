import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Resources collection — supporting educational/SEO content.
// Source of truth for content: docs/05-seo/resource-briefs/*.md
// File naming convention (per docs/05-seo/page-seo-standard.md
// "Resource File Names"): src/content/resources/{slug}.md maps to the
// public route /resources/{slug}/.
const resources = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/resources' }),
  schema: z.object({
    title: z.string(),
    seoTitle: z.string(),
    description: z.string(),
    publishDate: z.string(), // ISO date string, factual — see data-model/legal guardrails
    updatedDate: z.string().optional(),
    primaryDestination: z.object({
      label: z.string(),
      href: z.string(),
    }),
    secondaryDestinations: z.array(
      z.object({
        label: z.string(),
        href: z.string(),
      })
    ).default([]),
    relatedResources: z.array(z.string()).default([]), // slugs of other resources in this collection
  }),
});

export const collections = { resources };
