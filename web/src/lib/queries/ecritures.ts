import { getDb } from '../db';
import type { Ecriture } from '../types';

export interface EcritureFilters {
  unite_id?: string;
  category_id?: string;
  type?: string;
  date_debut?: string;
  date_fin?: string;
  mode_paiement_id?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listEcritures(filters: EcritureFilters = {}): { ecritures: Ecriture[]; total: number } {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.unite_id) { conditions.push('e.unite_id = ?'); values.push(filters.unite_id); }
  if (filters.category_id) { conditions.push('e.category_id = ?'); values.push(filters.category_id); }
  if (filters.type) { conditions.push('e.type = ?'); values.push(filters.type); }
  if (filters.date_debut) { conditions.push('e.date_ecriture >= ?'); values.push(filters.date_debut); }
  if (filters.date_fin) { conditions.push('e.date_ecriture <= ?'); values.push(filters.date_fin); }
  if (filters.mode_paiement_id) { conditions.push('e.mode_paiement_id = ?'); values.push(filters.mode_paiement_id); }
  if (filters.status) { conditions.push('e.status = ?'); values.push(filters.status); }
  if (filters.search) { conditions.push('(e.description LIKE ? OR e.notes LIKE ?)'); values.push(`%${filters.search}%`, `%${filters.search}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const ecritures = getDb().prepare(`
    SELECT e.*, u.code as unite_code, c.name as category_name, m.name as mode_paiement_name, a.name as activite_name,
      EXISTS(SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id) as has_justificatif
    FROM ecritures e
    LEFT JOIN unites u ON u.id = e.unite_id
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
    LEFT JOIN activites a ON a.id = e.activite_id
    ${where}
    ORDER BY e.date_ecriture DESC, e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as Ecriture[];

  const countRow = getDb().prepare(`SELECT COUNT(*) as total FROM ecritures e ${where}`).get(...values) as { total: number };

  return { ecritures, total: countRow.total };
}

export function getEcriture(id: string): Ecriture | undefined {
  return getDb().prepare(`
    SELECT e.*, u.code as unite_code, c.name as category_name, m.name as mode_paiement_name, a.name as activite_name
    FROM ecritures e
    LEFT JOIN unites u ON u.id = e.unite_id
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
    LEFT JOIN activites a ON a.id = e.activite_id
    WHERE e.id = ?
  `).get(id) as Ecriture | undefined;
}
