import { getDb } from '../db';
import type { Category, Unite, ModePaiement, Activite } from '../types';

export function listCategories(): Category[] {
  return getDb().prepare('SELECT id, name, type, comptaweb_nature FROM categories ORDER BY name').all() as Category[];
}

export function listUnites(): Unite[] {
  return getDb().prepare('SELECT id, code, name FROM unites ORDER BY code').all() as Unite[];
}

export function listModesPaiement(): ModePaiement[] {
  return getDb().prepare('SELECT id, name FROM modes_paiement ORDER BY name').all() as ModePaiement[];
}

export function listActivites(): Activite[] {
  return getDb().prepare('SELECT id, name FROM activites ORDER BY name').all() as Activite[];
}
