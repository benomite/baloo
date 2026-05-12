import type { MetadataRoute } from 'next';

// robots.txt servi automatiquement sur /robots.txt. Tout l'app authentifié
// + le flow d'auth est noindex. Seul /about et le manifest sont indexables.

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://baloo.benomite.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/about', '/'],
        disallow: [
          '/login',
          '/auth/',
          '/api/',
          '/admin/',
          '/moi/',
          '/ecritures/',
          '/remboursements/',
          '/abandons/',
          '/caisse/',
          '/depots/',
          '/depot/',
          '/inbox/',
          '/synthese/',
          '/budgets/',
          '/comptaweb/',
          '/cloture/',
          '/import/',
          '/aide/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
