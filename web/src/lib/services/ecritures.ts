import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import type { Ecriture } from '../types';

export interface EcritureContext {
  groupId: string;
}

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

// Renvoie la liste des champs manquants qui bloquent la synchronisation.
// Les drafts issus d'une ligne bancaire sont considérés "à compléter" s'il
// leur manque nature/activité/unité/mode ; une dépense est signalée "justif"
// manquante dès que justif_attendu=1 et aucun fichier rattaché — même si
// numero_piece est renseigné (le code Comptaweb permet la sync mais ne
// remplace pas le document physique). Le warning "justif" reste visible
// même après sync Comptaweb tant qu'aucun fichier n'est rattaché.
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

export function listEcritures(
  { groupId }: EcritureContext,
  filters: EcritureFilters = {},
): { ecritures: Ecriture[]; total: number } {
  const conditions: string[] = ['e.group_id = ?'];
  const values: unknown[] = [groupId];

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
    //   - dépense avec justif attendu mais aucun fichier rattaché (même
    //     post-sync Comptaweb : la ligne reste à compléter tant qu'on n'a
    //     pas le document).
    conditions.push(`(
      e.status = 'brouillon'
      OR (e.type = 'depense' AND e.justif_attendu = 1
          AND NOT EXISTS (
            SELECT 1 FROM justificatifs j
            WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id
          ))
    )`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const rows = getDb().prepare(
    `SELECT e.*, u.code as unite_code, u.name as unite_name, u.couleur as unite_couleur,
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
     LIMIT ? OFFSET ?`,
  ).all(...values, limit, offset) as Ecriture[];

  const ecritures = rows.map((e) => ({ ...e, missing_fields: computeMissingFields(e) }));
  const filtered = filters.incomplete
    ? ecritures.filter((e) => (e.missing_fields ?? []).length > 0)
    : ecritures;

  const countRow = getDb()
    .prepare(`SELECT COUNT(*) as total FROM ecritures e ${where}`)
    .get(...values) as { total: number };
  const total = filters.incomplete ? filtered.length : countRow.total;

  return { ecritures: filtered, total };
}

export function getEcriture({ groupId }: EcritureContext, id: string): Ecriture | undefined {
  return getDb().prepare(
    `SELECT e.*, u.code as unite_code, u.name as unite_name, u.couleur as unite_couleur,
       c.name as category_name, m.name as mode_paiement_name, a.name as activite_name,
       ca.porteur as carte_porteur, ca.type as carte_type
     FROM ecritures e
     LEFT JOIN unites u ON u.id = e.unite_id
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
     LEFT JOIN activites a ON a.id = e.activite_id
     LEFT JOIN cartes ca ON ca.id = e.carte_id
     WHERE e.id = ? AND e.group_id = ?`,
  ).get(id, groupId) as Ecriture | undefined;
}

export interface CreateEcritureInput {
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  unite_id?: string | null;
  category_id?: string | null;
  mode_paiement_id?: string | null;
  activite_id?: string | null;
  numero_piece?: string | null;
  carte_id?: string | null;
  justif_attendu?: 0 | 1 | boolean;
  notes?: string | null;
}

export function createEcriture(
  { groupId }: EcritureContext,
  input: CreateEcritureInput,
): Ecriture {
  const db = getDb();
  const prefix = input.type === 'depense' ? 'DEP' : 'REC';
  const id = nextId(prefix);
  const now = currentTimestamp();
  const justifAttendu = input.justif_attendu === undefined
    ? 1
    : (input.justif_attendu ? 1 : 0);

  db.prepare(
    `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, unite_id, category_id, mode_paiement_id, activite_id, numero_piece, carte_id, justif_attendu, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.date_ecriture,
    input.description,
    input.amount_cents,
    input.type,
    input.unite_id ?? null,
    input.category_id ?? null,
    input.mode_paiement_id ?? null,
    input.activite_id ?? null,
    input.numero_piece ?? null,
    input.carte_id ?? null,
    justifAttendu,
    input.notes ?? null,
    now,
    now,
  );

  return db.prepare('SELECT * FROM ecritures WHERE id = ?').get(id) as Ecriture;
}

export interface UpdateEcritureInput {
  date_ecriture?: string;
  description?: string;
  amount_cents?: number;
  type?: 'depense' | 'recette';
  unite_id?: string | null;
  category_id?: string | null;
  mode_paiement_id?: string | null;
  activite_id?: string | null;
  numero_piece?: string | null;
  carte_id?: string | null;
  justif_attendu?: 0 | 1 | boolean;
  status?: 'brouillon' | 'valide' | 'saisie_comptaweb';
  comptaweb_synced?: boolean;
  notes?: string | null;
}

// Champs autorisés à la mise à jour inline depuis la table /ecritures.
// Whitelist stricte pour éviter qu'un appelant abuse de updateEcritureField
// pour modifier date/montant/type sans passer par le form complet.
const INLINE_FIELDS_SYNC = ['unite_id', 'category_id', 'activite_id', 'mode_paiement_id', 'carte_id'] as const;
const INLINE_FIELDS_INTERNAL = ['justif_attendu', 'notes'] as const;
export type InlineField = (typeof INLINE_FIELDS_SYNC)[number] | (typeof INLINE_FIELDS_INTERNAL)[number];

export function updateEcriture(
  { groupId }: EcritureContext,
  id: string,
  patch: UpdateEcritureInput,
): Ecriture | null {
  // Une fois synchronisée avec Comptaweb, l'écriture devient en lecture seule
  // pour les champs sync (date, montant, type, unité, nature, carte, etc.).
  // Seuls les champs purement internes à Baloo (notes, justif_attendu) et la
  // transition de statut/comptaweb_synced restent applicables. Les autres
  // champs sont silencieusement ignorés — l'UX renvoie déjà la lecture seule.
  const current = getDb()
    .prepare('SELECT status FROM ecritures WHERE id = ? AND group_id = ?')
    .get(id, groupId) as { status: string } | undefined;
  if (!current) return null;
  const lockSync = current.status === 'saisie_comptaweb';

  const sets: string[] = [];
  const values: unknown[] = [];

  if (!lockSync && patch.date_ecriture !== undefined) { sets.push('date_ecriture = ?'); values.push(patch.date_ecriture); }
  if (!lockSync && patch.description !== undefined) { sets.push('description = ?'); values.push(patch.description); }
  if (!lockSync && patch.amount_cents !== undefined) { sets.push('amount_cents = ?'); values.push(patch.amount_cents); }
  if (!lockSync && patch.type !== undefined) { sets.push('type = ?'); values.push(patch.type); }
  if (!lockSync && patch.unite_id !== undefined) { sets.push('unite_id = ?'); values.push(patch.unite_id); }
  if (!lockSync && patch.category_id !== undefined) { sets.push('category_id = ?'); values.push(patch.category_id); }
  if (!lockSync && patch.mode_paiement_id !== undefined) { sets.push('mode_paiement_id = ?'); values.push(patch.mode_paiement_id); }
  if (!lockSync && patch.activite_id !== undefined) { sets.push('activite_id = ?'); values.push(patch.activite_id); }
  if (!lockSync && patch.numero_piece !== undefined) { sets.push('numero_piece = ?'); values.push(patch.numero_piece); }
  if (!lockSync && patch.carte_id !== undefined) { sets.push('carte_id = ?'); values.push(patch.carte_id); }
  if (patch.justif_attendu !== undefined) { sets.push('justif_attendu = ?'); values.push(patch.justif_attendu ? 1 : 0); }
  if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
  if (patch.comptaweb_synced !== undefined) { sets.push('comptaweb_synced = ?'); values.push(patch.comptaweb_synced ? 1 : 0); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes); }

  if (sets.length === 0) {
    return getEcriture({ groupId }, id) ?? null;
  }

  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = getDb()
    .prepare(`UPDATE ecritures SET ${sets.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return getEcriture({ groupId }, id) ?? null;
}

export function updateEcritureStatus(
  ctx: EcritureContext,
  id: string,
  status: 'brouillon' | 'valide' | 'saisie_comptaweb',
): Ecriture | null {
  const patch: UpdateEcritureInput = { status };
  if (status === 'saisie_comptaweb') {
    patch.comptaweb_synced = true;
  }
  return updateEcriture(ctx, id, patch);
}

// Édition inline atomique sur un seul champ. Contrairement à updateEcriture
// (qui ignore silencieusement), ici on retourne une erreur explicite si
// l'écriture est verrouillée Comptaweb — l'UX a besoin de le savoir pour
// afficher un toast.
export function updateEcritureField(
  { groupId }: EcritureContext,
  id: string,
  field: InlineField,
  value: string | number | null,
): { ok: true; ecriture: Ecriture } | { ok: false; reason: 'not_found' | 'sync_locked' | 'invalid_field' } {
  const isSyncField = (INLINE_FIELDS_SYNC as readonly string[]).includes(field);
  const isInternalField = (INLINE_FIELDS_INTERNAL as readonly string[]).includes(field);
  if (!isSyncField && !isInternalField) return { ok: false, reason: 'invalid_field' };

  const current = getDb()
    .prepare('SELECT status FROM ecritures WHERE id = ? AND group_id = ?')
    .get(id, groupId) as { status: string } | undefined;
  if (!current) return { ok: false, reason: 'not_found' };
  if (current.status === 'saisie_comptaweb' && isSyncField) {
    return { ok: false, reason: 'sync_locked' };
  }

  const normalised = value === '' ? null : value;
  const patch: UpdateEcritureInput = { [field]: normalised } as UpdateEcritureInput;
  const updated = updateEcriture({ groupId }, id, patch);
  if (!updated) return { ok: false, reason: 'not_found' };
  return { ok: true, ecriture: updated };
}

export interface BatchPatch {
  unite_id?: string | null;
  category_id?: string | null;
  activite_id?: string | null;
  mode_paiement_id?: string | null;
  carte_id?: string | null;
  justif_attendu?: 0 | 1;
  description_prefix?: string;
}

export interface BatchResult {
  updated: number;
  skipped: number;
}

// Mise à jour en masse : n'agit que sur les écritures modifiables (brouillon
// ou valide). Les écritures synchronisées Comptaweb sont ignorées pour éviter
// un décalage silencieux avec la prod.
export function batchUpdateEcritures(
  { groupId }: EcritureContext,
  ids: string[],
  patch: BatchPatch,
): BatchResult {
  if (ids.length === 0) return { updated: 0, skipped: 0 };

  const db = getDb();
  const now = currentTimestamp();

  const setClauses: string[] = [];
  const setValues: unknown[] = [];
  if (patch.unite_id !== undefined) { setClauses.push('unite_id = ?'); setValues.push(patch.unite_id); }
  if (patch.category_id !== undefined) { setClauses.push('category_id = ?'); setValues.push(patch.category_id); }
  if (patch.activite_id !== undefined) { setClauses.push('activite_id = ?'); setValues.push(patch.activite_id); }
  if (patch.mode_paiement_id !== undefined) { setClauses.push('mode_paiement_id = ?'); setValues.push(patch.mode_paiement_id); }
  if (patch.carte_id !== undefined) { setClauses.push('carte_id = ?'); setValues.push(patch.carte_id); }
  if (patch.justif_attendu !== undefined) { setClauses.push('justif_attendu = ?'); setValues.push(patch.justif_attendu); }
  const prefix = patch.description_prefix?.trim();
  const hasChanges = setClauses.length > 0 || !!prefix;
  if (!hasChanges) return { updated: 0, skipped: 0 };

  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, status, description FROM ecritures WHERE group_id = ? AND id IN (${placeholders})`)
    .all(groupId, ...ids) as { id: string; status: string; description: string }[];

  const editable = rows.filter((r) => r.status !== 'saisie_comptaweb');
  const skipped = ids.length - editable.length;
  if (editable.length === 0) return { updated: 0, skipped };

  const updateCore = setClauses.length > 0
    ? db.prepare(`UPDATE ecritures SET ${setClauses.join(', ')}, updated_at = ? WHERE id = ? AND group_id = ?`)
    : null;
  const updateDesc = prefix
    ? db.prepare('UPDATE ecritures SET description = ?, updated_at = ? WHERE id = ? AND group_id = ?')
    : null;

  const tx = db.transaction(() => {
    for (const row of editable) {
      if (updateCore) updateCore.run(...setValues, now, row.id, groupId);
      if (updateDesc) {
        const sep = ' — ';
        const already = row.description.startsWith(prefix + sep);
        const next = already ? row.description : `${prefix}${sep}${row.description}`;
        updateDesc.run(next, now, row.id, groupId);
      }
    }
  });
  tx();

  return { updated: editable.length, skipped };
}
