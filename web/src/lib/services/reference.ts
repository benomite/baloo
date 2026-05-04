import { getDb } from '../db';
import type { Category, Unite, ModePaiement, Activite } from '../types';

export interface ReferenceContext {
  groupId: string;
}

// categories et modes_paiement sont des référentiels SGDF nationaux : pas de
// group_id, mêmes valeurs pour tous les groupes.

export async function listCategories(): Promise<Category[]> {
  return await getDb()
    .prepare('SELECT id, name, type, comptaweb_nature FROM categories ORDER BY name')
    .all<Category>();
}

export async function listModesPaiement(): Promise<ModePaiement[]> {
  return await getDb()
    .prepare('SELECT id, name FROM modes_paiement ORDER BY name')
    .all<ModePaiement>();
}

// unites et activites sont spécifiques au groupe (group_id NOT NULL).

export async function listUnites({ groupId }: ReferenceContext): Promise<Unite[]> {
  return await getDb()
    .prepare('SELECT id, code, name, couleur FROM unites WHERE group_id = ? ORDER BY code')
    .all<Unite>(groupId);
}

export async function listActivites({ groupId }: ReferenceContext): Promise<Activite[]> {
  return await getDb()
    .prepare('SELECT id, name FROM activites WHERE group_id = ? ORDER BY name')
    .all<Activite>(groupId);
}

// Top N catégories les plus utilisées par un groupe (basé sur les
// écritures existantes). Sert à alimenter un sélecteur "favoris" dans
// les formulaires : les 4-5 catégories les plus fréquentes en chips
// rapides, le reste en select déroulant.
//
// Si le groupe est vierge (aucune écriture), retourne []. Le composant
// dégrade alors vers un select complet.
export async function getTopCategoryIdsForGroup(
  { groupId }: ReferenceContext,
  limit = 5,
): Promise<string[]> {
  const rows = await getDb()
    .prepare(
      `SELECT category_id, COUNT(*) AS n
       FROM ecritures
       WHERE group_id = ? AND category_id IS NOT NULL
       GROUP BY category_id
       ORDER BY n DESC
       LIMIT ?`,
    )
    .all<{ category_id: string; n: number }>(groupId, limit);
  return rows.map((r) => r.category_id);
}
