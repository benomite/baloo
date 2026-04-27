import { getDb } from '../db';
import { currentTimestamp, uniqueId } from '../ids';
import type { Carte } from '../types';

export interface CartesContext {
  groupId: string;
}

const TYPES = ['cb', 'procurement'] as const;
type CarteType = (typeof TYPES)[number];

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function listCartes({ groupId }: CartesContext, opts: { statut?: 'active' | 'ancienne' } = {}): Carte[] {
  const statut = opts.statut ?? 'active';
  return getDb()
    .prepare(
      `SELECT id, type, porteur, comptaweb_id, code_externe, statut
       FROM cartes WHERE group_id = ? AND statut = ?
       ORDER BY type, porteur`,
    )
    .all(groupId, statut) as Carte[];
}

export interface CreateCarteInput {
  type: CarteType;
  porteur: string;
  comptaweb_id?: number | null;
  code_externe?: string | null;
}

export function createCarte({ groupId }: CartesContext, input: CreateCarteInput): Carte {
  const base = `carte-${input.type === 'procurement' ? 'proc' : 'cb'}-${slugify(input.porteur)}`;
  const id = uniqueId('cartes', base);
  const now = currentTimestamp();
  getDb()
    .prepare(
      `INSERT INTO cartes (id, group_id, type, porteur, comptaweb_id, code_externe, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, groupId, input.type, input.porteur, input.comptaweb_id ?? null, input.code_externe ?? null, now, now);
  return getDb().prepare('SELECT id, type, porteur, comptaweb_id, code_externe, statut FROM cartes WHERE id = ?').get(id) as Carte;
}

export interface UpdateCarteInput {
  porteur?: string;
  comptaweb_id?: number | null;
  code_externe?: string | null;
  statut?: 'active' | 'ancienne';
}

export function updateCarte({ groupId }: CartesContext, id: string, patch: UpdateCarteInput): Carte | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.porteur !== undefined) { sets.push('porteur = ?'); values.push(patch.porteur); }
  if (patch.comptaweb_id !== undefined) { sets.push('comptaweb_id = ?'); values.push(patch.comptaweb_id); }
  if (patch.code_externe !== undefined) { sets.push('code_externe = ?'); values.push(patch.code_externe); }
  if (patch.statut !== undefined) { sets.push('statut = ?'); values.push(patch.statut); }
  if (sets.length === 0) {
    const row = getDb()
      .prepare('SELECT id, type, porteur, comptaweb_id, code_externe, statut FROM cartes WHERE id = ? AND group_id = ?')
      .get(id, groupId) as Carte | undefined;
    return row ?? null;
  }
  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);
  const info = getDb()
    .prepare(`UPDATE cartes SET ${sets.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (info.changes === 0) return null;
  return getDb()
    .prepare('SELECT id, type, porteur, comptaweb_id, code_externe, statut FROM cartes WHERE id = ?')
    .get(id) as Carte;
}
