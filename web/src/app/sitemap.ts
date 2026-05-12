import type { MetadataRoute } from 'next';

// Sitemap minimal pour Google. Seules les pages publiques sont listées.
// Tout l'app authentifié est exclu par robots.ts.

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://baloo.benomite.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: `${SITE_URL}/about`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 1.0,
    },
  ];
}
