import { getDb } from '../db';
import type { Remboursement } from '../types';

export interface RemboursementFilters {
  status?: string;
  unite_id?: string;
  demandeur?: string;
  search?: string;
  limit?: number;
}

export function listRemboursements(filters: RemboursementFilters = {}): Remboursement[] {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.status) { conditions.push('r.status = ?'); values.push(filters.status); }
  if (filters.unite_id) { conditions.push('r.unite_id = ?'); values.push(filters.unite_id); }
  if (filters.demandeur) { conditions.push('r.demandeur LIKE ?'); values.push(`%${filters.demandeur}%`); }
  if (filters.search) { conditions.push('(r.demandeur LIKE ? OR r.nature LIKE ? OR r.notes LIKE ?)'); values.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return getDb().prepare(`
    SELECT r.*, u.code as unite_code, m.name as mode_paiement_name
    FROM remboursements r
    LEFT JOIN unites u ON u.id = r.unite_id
    LEFT JOIN modes_paiement m ON m.id = r.mode_paiement_id
    ${where}
    ORDER BY r.created_at DESC LIMIT ?
  `).all(...values, filters.limit ?? 50) as Remboursement[];
}

export function getRemboursement(id: string): Remboursement | undefined {
  return getDb().prepare(`
    SELECT r.*, u.code as unite_code, m.name as mode_paiement_name
    FROM remboursements r
    LEFT JOIN unites u ON u.id = r.unite_id
    LEFT JOIN modes_paiement m ON m.id = r.mode_paiement_id
    WHERE r.id = ?
  `).get(id) as Remboursement | undefined;
}
