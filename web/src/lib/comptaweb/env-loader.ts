// Source auxiliaire de variables d'environnement : compta/.env est déjà
// maintenu pour le serveur MCP ; plutôt que de dupliquer les credentials
// Comptaweb et BALOO_* dans web/.env.local, on les lit depuis compta/.env.
// On charge aussi le `.env` racine (qui contient AIRTABLE_PAT,
// GOOGLE_OAUTH_*, etc. utilisés par les MCP). À appeler au tout début
// des server actions / scripts qui en ont besoin.
//
// TODO : supprimer ce helper quand on aura un paquet partagé.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFile(path: string): boolean {
  try {
    const raw = readFileSync(path, 'utf-8');
    const vars = parseEnv(raw);
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    return true;
  } catch {
    return false;
  }
}

export function ensureComptawebEnv(): void {
  if (loaded) return;
  loaded = true;
  // On essaie chaque chemin (cwd-relatif) et on charge tous ceux qui
  // existent — additif, pas exclusif. Les vars déjà set dans
  // process.env (vraies env vars système) ne sont jamais écrasées.
  const candidates = [
    // compta/.env (Comptaweb credentials, BALOO_*)
    resolve(process.cwd(), 'compta/.env'),
    resolve(process.cwd(), '../compta/.env'),
    // .env racine (Airtable PAT, Google OAuth, etc.)
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
  ];
  for (const path of candidates) {
    loadEnvFile(path);
  }
}
