import type { NextConfig } from "next";

// Headers de sécurité appliqués à toutes les routes. Pas de CSP au MVP
// (l'inline script de Next.js demande une stratégie nonce/hash dédiée
// — à faire dans une passe ultérieure).
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

if (process.env.NODE_ENV === 'production') {
  // HSTS : uniquement en prod (le dev tourne sur http://localhost).
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  });
}

const nextConfig: NextConfig = {
  // Force la racine Turbopack sur le cwd (= web/ quand on lance `pnpm dev`).
  // Sans ça, Next 16 remonte au niveau parent (à cause de pnpm-workspace.yaml
  // ou d'un lockfile orphelin) et casse la résolution des modules
  // (tailwindcss notamment).
  turbopack: { root: process.cwd() },
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
