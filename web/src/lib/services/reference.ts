import { getDb } from '../db';
import type { Category, Unite, ModePaiement, Activite } from '../types';

export interface ReferenceContext {
  groupId: string;
}

// categories et modes_paiement sont des référentiels SGDF nationaux : pas de
// group_id, mêmes valeurs pour tous les groupes.

export function listCategories(): Category[] {
  return getDb()
    .prepare('SELECT id, name, type, comptaweb_nature FROM categories ORDER BY name')
    .all() as Category[];
}

export function listModesPaiement(): ModePaiement[] {
  return getDb()
    .prepare('SELECT id, name FROM modes_paiement ORDER BY name')
    .all() as ModePaiement[];
}

// unites et activites sont spécifiques au groupe (group_id NOT NULL).

export function listUnites({ groupId }: ReferenceContext): Unite[] {
  return getDb()
    .prepare('SELECT id, code, name, couleur FROM unites WHERE group_id = ? ORDER BY code')
    .all(groupId) as Unite[];
}

export function listActivites({ groupId }: ReferenceContext): Activite[] {
  return getDb()
    .prepare('SELECT id, name FROM activites WHERE group_id = ? ORDER BY name')
    .all(groupId) as Activite[];
}
