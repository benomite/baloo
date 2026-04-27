import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Force la racine Turbopack sur le cwd (= web/ quand on lance `pnpm dev`).
  // Sans ça, Next 16 remonte au niveau parent (à cause de pnpm-workspace.yaml
  // ou d'un lockfile orphelin) et casse la résolution des modules
  // (tailwindcss notamment).
  turbopack: { root: process.cwd() },
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default nextConfig;
