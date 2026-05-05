// Charge `compta/.env` dans `process.env` au démarrage du MCP.
//
// Le MCP est lancé par Claude Code via `.mcp.json` qui n'injecte pas
// d'env (cf. .mcp.json `compta` entry). Sans ce loader, BALOO_API_TOKEN
// reste undefined → toutes les requêtes vers l'API webapp renvoient 401.
//
// Implémentation inline sans dépendance dotenv : ~20 lignes suffisent
// pour le format strict KEY=value que produit `scripts/generate-api-token.ts`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env');

try {
  const content = readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // .env absent : on laisse les fallbacks (localhost, pas de token).
}
