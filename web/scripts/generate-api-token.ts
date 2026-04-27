#!/usr/bin/env tsx
/**
 * CLI : génère un token API long-vie pour un user (chantier 4, ADR-014).
 *
 * Usage :
 *   pnpm exec tsx scripts/generate-api-token.ts <user-email> [--name "MCP local"]
 *
 * Le token brut est imprimé sur stdout (à copier dans `compta/.env` sous
 * `BALOO_API_TOKEN=`). Il n'est plus jamais affiché ensuite — seul un hash
 * SHA-256 est stocké en BDD.
 */

import { createApiToken } from '../src/lib/auth/api-tokens';
import { getDb } from '../src/lib/db';
import { ensureAuthSchema } from '../src/lib/auth/schema';

function parseArgs(argv: string[]): { email?: string; name: string } {
  const args = argv.slice(2);
  let email: string | undefined;
  let name = 'MCP baloo-compta';
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

function main(): void {
  const { email, name } = parseArgs(process.argv);
  if (!email) {
    console.error("Usage: generate-api-token.ts <user-email> [--name 'MCP local']");
    process.exit(1);
  }

  ensureAuthSchema();

  const row = getDb()
    .prepare("SELECT id FROM users WHERE email = ? AND statut = 'actif' LIMIT 1")
    .get(email) as { id: string } | undefined;

  if (!row) {
    console.error(`Aucun user actif avec l'email ${email}.`);
    console.error('Vérifie compta/.env (BALOO_USER_EMAIL) puis lance `cd compta && npm run bootstrap`.');
    process.exit(1);
  }

  const created = createApiToken({ userId: row.id, name });

  console.log(`Token créé pour ${email} ("${name}"). ID interne: ${created.id}`);
  console.log('');
  console.log('À copier dans compta/.env :');
  console.log('');
  console.log(`BALOO_API_TOKEN=${created.rawToken}`);
  console.log('');
  console.log('Ce token n\'est affiché qu\'une fois. Stocké en BDD sous forme de hash SHA-256.');
}

main();
