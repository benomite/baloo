#!/usr/bin/env tsx
/**
 * CLI : génère un token API long-vie pour un user (chantier 4, ADR-014).
 *
 * Usage :
 *   pnpm exec tsx scripts/generate-api-token.ts <user-email> [--name "client xyz"]
 *
 * Le token brut est imprimé sur stdout (à copier dans le client qui en a
 * besoin, par exemple un script externe). Il n'est plus jamais affiché
 * ensuite — seul un hash SHA-256 est stocké en BDD.
 *
 * Note : le MCP Baloo s'auth désormais via OAuth (cf. /api/mcp + page
 * `/moi/connexions`). Ce script reste utile pour un PAT côté script CLI.
 */

import { createApiToken } from '../src/lib/auth/api-tokens';
import { getDb } from '../src/lib/db';
import { ensureAuthSchema } from '../src/lib/auth/schema';

function parseArgs(argv: string[]): { email?: string; name: string } {
  const args = argv.slice(2);
  let email: string | undefined;
  let name = 'API token';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name' && i + 1 < args.length) {
      name = args[++i];
    } else if (!email && !a.startsWith('--')) {
      email = a;
    }
  }
  return { email, name };
}

async function main(): Promise<void> {
  const { email, name } = parseArgs(process.argv);
  if (!email) {
    console.error("Usage: generate-api-token.ts <user-email> [--name 'MCP local']");
    process.exit(1);
  }

  await ensureAuthSchema();

  const row = await getDb()
    .prepare("SELECT id FROM users WHERE email = ? AND statut = 'actif' LIMIT 1")
    .get<{ id: string }>(email);

  if (!row) {
    console.error(`Aucun user actif avec l'email ${email}.`);
    console.error('Vérifie web/.env.local (BALOO_USER_EMAIL) puis lance `pnpm bootstrap` dans web/.');
    process.exit(1);
  }

  const created = await createApiToken({ userId: row.id, name });

  console.log(`Token créé pour ${email} ("${name}"). ID interne: ${created.id}`);
  console.log('');
  console.log('Token brut (à conserver côté client) :');
  console.log('');
  console.log(`BALOO_API_TOKEN=${created.rawToken}`);
  console.log('');
  console.log('Ce token n\'est affiché qu\'une fois. Stocké en BDD sous forme de hash SHA-256.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
