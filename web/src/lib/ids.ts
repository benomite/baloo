import { getDb, type DbWrapper } from './db';

// Variante de `nextId` qui prend un `DbWrapper` explicite. Permet de
// générer un id depuis une transaction ou un test avec une BDD in-memory
// (le `getDb()` du nextId default ne peut pas être routé).
// Cherche uniquement dans la table `ecritures` quand la table cible est
// `ecritures` — pour les tests en BDD minimale qui n'ont pas toutes les
// tables. En prod (BDD complète), recouvre l'union historique pour
// préserver l'unicité cross-tables (l'ancien `nextId` global).
export async function nextIdOn(
  db: DbWrapper,
  prefix: string,
  options: { tables?: readonly string[]; year?: number } = {},
): Promise<string> {
  const y = options.year ?? new Date().getFullYear();
  const pattern = `${prefix}-${y}-%`;
  const tables = options.tables ?? [
    'ecritures', 'remboursements', 'abandons_frais', 'mouvements_caisse',
    'depots_cheques', 'depots_especes', 'depots_justificatifs', 'justificatifs',
    'comptaweb_imports',
  ];

  // Filtre à la volée les tables absentes (BDDs de test minimales) :
  // SELECT sur une table inexistante plante toute l'union, mais on n'a
  // pas de catalogue stable cross-engines pour distinguer en amont.
  // Approche pragmatique : tente le union ; si erreur, retombe sur le
  // prefix-only sur la table par défaut `ecritures`.
  const union = tables.map((t) => `SELECT id FROM ${t} WHERE id LIKE ?`).join(' UNION ALL ');
  try {
    const row = await db
      .prepare(`SELECT id FROM (${union}) ORDER BY id DESC LIMIT 1`)
      .get<{ id: string }>(...tables.map(() => pattern));
    if (!row) return `${prefix}-${y}-001`;
    const lastNum = parseInt(row.id.split('-').pop()!, 10);
    return `${prefix}-${y}-${String(lastNum + 1).padStart(3, '0')}`;
  } catch {
    const fallback = await db
      .prepare(`SELECT id FROM ecritures WHERE id LIKE ? ORDER BY id DESC LIMIT 1`)
      .get<{ id: string }>(pattern);
    if (!fallback) return `${prefix}-${y}-001`;
    const lastNum = parseInt(fallback.id.split('-').pop()!, 10);
    return `${prefix}-${y}-${String(lastNum + 1).padStart(3, '0')}`;
  }
}

export async function nextId(prefix: string, year?: number): Promise<string> {
  return nextIdOn(getDb(), prefix, year !== undefined ? { year } : {});
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
