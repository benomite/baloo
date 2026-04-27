// Helper de résolution du contexte courant pour les scripts CLI.
//
// `getCurrentContext()` (dans web/src/lib/context.ts) est async et lit la
// session Auth.js — ça ne marche pas hors d'une requête HTTP. Pour les
// scripts CLI, on s'appuie sur `BALOO_USER_EMAIL` chargé depuis
// `compta/.env` via `ensureComptawebEnv()`.

import { ensureComptawebEnv } from '../src/lib/comptaweb/env-loader';
import { getDb } from '../src/lib/db';

export interface CliContext {
  userId: string;
  groupId: string;
  email: string;
}

export async function getCliContext(): Promise<CliContext> {
  ensureComptawebEnv();
  const email = process.env.BALOO_USER_EMAIL;
  if (!email) {
    throw new Error(
      'BALOO_USER_EMAIL non défini (compta/.env). Lance `cd compta && cp .env.example .env`.',
    );
  }
  const row = await getDb()
    .prepare("SELECT id, group_id FROM users WHERE email = ? AND statut = 'actif' LIMIT 1")
    .get<{ id: string; group_id: string }>(email);
  if (!row) {
    throw new Error(
      `Aucun user actif avec l'email ${email}. Lance d'abord \`pnpm bootstrap\` dans web/.`,
    );
  }
  return { userId: row.id, groupId: row.group_id, email };
}
