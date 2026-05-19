// Source auxiliaire de variables d'environnement : on charge le `.env`
// racine (qui contient AIRTABLE_PAT, GOOGLE_OAUTH_*, etc. utilisés par
// les MCP externes) en complément des variables déjà présentes dans
// `process.env`. À appeler au tout début des server actions / scripts
// qui en ont besoin.
//
// Historique : ce helper chargeait aussi `compta/.env` du temps où le
// MCP `baloo-compta` standalone existait. Le dossier `compta/` a été
// supprimé (Phase 1 du pivot V1) — les vars Comptaweb et BALOO_*
// vivent désormais dans `web/.env.local` ou dans les env vars Vercel.

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
    // .env racine (Airtable PAT, Google OAuth, etc.)
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
    // web/.env.local (Comptaweb credentials, BALOO_*, en dev local)
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), 'web/.env.local'),
  ];
  for (const path of candidates) {
    loadEnvFile(path);
  }
}
