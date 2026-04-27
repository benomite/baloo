import { getDb } from '../db';
import type { Ecriture } from '../types';

export interface EcritureFilters {
  unite_id?: string;
  category_id?: string;
  type?: string;
  date_debut?: string;
  date_fin?: string;
  mode_paiement_id?: string;
  carte_id?: string;
  // Format YYYY-MM. Filtre les écritures du mois donné.
  month?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
  // Préset : uniquement les drafts avec au moins un champ obligatoire manquant.
  incomplete?: boolean;
  // Préset : uniquement les écritures issues d'une ligne bancaire Comptaweb.
  from_bank?: boolean;
}

// Renvoie la liste des champs manquants qui bloquent la synchronisation ou
// qui justifient qu'on laisse l'écriture en brouillon. Une dépense est
// signalée "justif" manquante dès que justif_attendu=1 et aucun fichier
// n'est rattaché — même si numero_piece est renseigné (le code Comptaweb
// permet la sync mais ne remplace pas le document).
//
// Le warning "justif" reste visible même après sync Comptaweb : la sync est
// possible avec juste un numero_piece, mais tant que le fichier physique n'est
// pas rattaché dans Baloo, la ligne reste "à compléter".
export function computeMissingFields(e: {
  status: string;
  category_id: string | null;
  activite_id: string | null;
  unite_id: string | null;
  mode_paiement_id: string | null;
  type: string;
  numero_piece: string | null;
  justif_attendu: number;
  has_justificatif?: boolean;
}): string[] {
  const missing: string[] = [];
  if (e.status === 'brouillon') {
    if (!e.category_id) missing.push('nature');
    if (!e.activite_id) missing.push('activité');
    if (!e.unite_id) missing.push('unité');
    if (!e.mode_paiement_id) missing.push('mode');
  }
  if (e.type === 'depense' && e.justif_attendu === 1 && !e.has_justificatif) {
    missing.push('justif');
  }
  return missing;
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
  if (filters.carte_id) { conditions.push('e.carte_id = ?'); values.push(filters.carte_id); }
  if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    conditions.push('e.date_ecriture LIKE ?');
    values.push(`${filters.month}%`);
  }
  if (filters.status) { conditions.push('e.status = ?'); values.push(filters.status); }
  if (filters.search) { conditions.push('(e.description LIKE ? OR e.notes LIKE ?)'); values.push(`%${filters.search}%`, `%${filters.search}%`); }
  if (filters.from_bank) { conditions.push('e.ligne_bancaire_id IS NOT NULL'); }
  if (filters.incomplete) {
    // Deux cas éligibles :
    //   - brouillon (post-filter précise si un champ manque vraiment)
    //   - dépense avec justif attendu mais aucun fichier rattaché (même post-sync
    //     Comptaweb : la ligne reste à compléter tant qu'on n'a pas le document).
    conditions.push(`(
      e.status = 'brouillon'
      OR (e.type = 'depense' AND e.justif_attendu = 1
          AND NOT EXISTS (
            SELECT 1 FROM justificatifs j
            WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id
          ))
    )`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const rows = getDb().prepare(`
    SELECT e.*, u.code as unite_code, u.name as unite_name, u.couleur as unite_couleur,
      c.name as category_name, m.name as mode_paiement_name, a.name as activite_name,
      ca.porteur as carte_porteur, ca.type as carte_type,
      EXISTS(SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id) as has_justificatif
    FROM ecritures e
    LEFT JOIN unites u ON u.id = e.unite_id
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
    LEFT JOIN activites a ON a.id = e.activite_id
    LEFT JOIN cartes ca ON ca.id = e.carte_id
    ${where}
    ORDER BY
      CASE e.status WHEN 'brouillon' THEN 0 WHEN 'valide' THEN 1 ELSE 2 END,
      e.date_ecriture DESC, e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as Ecriture[];

  const ecritures = rows.map((e) => ({ ...e, missing_fields: computeMissingFields(e) }));
  const filtered = filters.incomplete
    ? ecritures.filter((e) => (e.missing_fields ?? []).length > 0)
    : ecritures;

  const countRow = getDb().prepare(`SELECT COUNT(*) as total FROM ecritures e ${where}`).get(...values) as { total: number };
  const total = filters.incomplete
    ? filtered.length // approximation : le filter affine le count sur la page visible
    : countRow.total;

  return { ecritures: filtered, total };
}

export function getEcriture(id: string): Ecriture | undefined {
  return getDb().prepare(`
    SELECT e.*, u.code as unite_code, u.name as unite_name, u.couleur as unite_couleur,
      c.name as category_name, m.name as mode_paiement_name, a.name as activite_name,
      ca.porteur as carte_porteur, ca.type as carte_type
    FROM ecritures e
    LEFT JOIN unites u ON u.id = e.unite_id
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
    LEFT JOIN activites a ON a.id = e.activite_id
    LEFT JOIN cartes ca ON ca.id = e.carte_id
    WHERE e.id = ?
  `).get(id) as Ecriture | undefined;
}
