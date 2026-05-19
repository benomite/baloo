import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // .test.ts (node par défaut) + .test.tsx (jsdom via `// @vitest-environment jsdom`
    // en tête de chaque fichier UI — évite de payer le coût jsdom sur tous les tests).
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
