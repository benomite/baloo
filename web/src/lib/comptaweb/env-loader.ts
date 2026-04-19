// Source auxiliaire de variables d'environnement : compta/.env est déjà
// maintenu pour le serveur MCP ; plutôt que de dupliquer les credentials
// Comptaweb et BALOO_* dans web/.env.local, on les lit depuis compta/.env.
// À appeler au tout début des server actions qui en ont besoin.
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

export function ensureComptawebEnv(): void {
  if (loaded) return;
  loaded = true;
  const candidates = [
    resolve(process.cwd(), 'compta/.env'),
    resolve(process.cwd(), '../compta/.env'),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf-8');
      const vars = parseEnv(raw);
      for (const [k, v] of Object.entries(vars)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
      return;
    } catch {
      // try next
    }
  }
}
