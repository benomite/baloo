import { getDb } from '../db';
import { getCurrentContext } from '../context';
import type { Category, Unite, ModePaiement, Activite, Carte } from '../types';

export function listCategories(): Category[] {
  return getDb().prepare('SELECT id, name, type, comptaweb_nature FROM categories ORDER BY name').all() as Category[];
}

export function listUnites(): Unite[] {
  return getDb().prepare('SELECT id, code, name, couleur FROM unites ORDER BY code').all() as Unite[];
}

export function listModesPaiement(): ModePaiement[] {
  return getDb().prepare('SELECT id, name FROM modes_paiement ORDER BY name').all() as ModePaiement[];
}

export function listActivites(): Activite[] {
  return getDb().prepare('SELECT id, name FROM activites ORDER BY name').all() as Activite[];
}

export function listCartes(): Carte[] {
  const { groupId } = getCurrentContext();
  return getDb()
    .prepare(
      `SELECT id, type, porteur, comptaweb_id, code_externe, statut
       FROM cartes WHERE group_id = ? AND statut = 'active'
       ORDER BY type, porteur`,
    )
    .all(groupId) as Carte[];
}
