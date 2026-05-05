import { getDb } from './db';

export async function nextId(prefix: string, year?: number): Promise<string> {
  const y = year ?? new Date().getFullYear();
  const pattern = `${prefix}-${y}-%`;
  const tables = ['ecritures', 'remboursements', 'abandons_frais', 'mouvements_caisse', 'depots_cheques', 'depots_especes', 'depots_justificatifs', 'justificatifs', 'comptaweb_imports'];
  const union = tables.map(t => `SELECT id FROM ${t} WHERE id LIKE ?`).join(' UNION ALL ');

  const row = await getDb()
    .prepare(`SELECT id FROM (${union}) ORDER BY id DESC LIMIT 1`)
    .get<{ id: string }>(...tables.map(() => pattern));

  if (!row) return `${prefix}-${y}-001`;

  const lastNum = parseInt(row.id.split('-').pop()!, 10);
  return `${prefix}-${y}-${String(lastNum + 1).padStart(3, '0')}`;
}

export function currentTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Génère un id stable + unique pour une table donnée. Si `wanted` existe
// déjà, suffixe `-2`, `-3`, etc. jusqu'à trouver une valeur libre.
// Cap à 100 pour éviter une boucle infinie sur un slug saturé.
export async function uniqueId(table: string, wanted: string): Promise<string> {
  const db = getDb();
  const check = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
  let id = wanted;
  for (let i = 2; await check.get(id); i++) {
    id = `${wanted}-${i}`;
    if (i > 100) throw new Error(`Impossible de générer un id unique pour ${wanted} dans ${table}`);
  }
  return id;
}
