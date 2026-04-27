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
