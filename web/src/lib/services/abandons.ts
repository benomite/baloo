import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { nullIfEmpty } from '../utils/form';

// Workflow d'un abandon de frais :
//   a_traiter (soumis par le donateur)
//     → valide (validé par le trésorier / RG)
//        → envoye_national (envoyé à donateurs@sgdf.fr avec le PDF
//          signé en PJ — l'admin déclare manuellement quand c'est fait)
//   a_traiter | valide → refuse (avec motif_refus)
//
// Le flag `cerfa_emis` est séparé du status car le retour CERFA arrive
// en async depuis le national, parfois plusieurs semaines après l'envoi.
// Une fois `envoye_national`, le status reste figé et seul `cerfa_emis`
// passe à 1 quand on reçoit confirmation.
export type AbandonStatus = 'a_traiter' | 'valide' | 'envoye_national' | 'refuse';

export const ABANDON_STATUS_LABELS: Record<AbandonStatus, string> = {
  a_traiter: 'À traiter',
  valide: 'Validé',
  envoye_national: 'Envoyé au national',
  refuse: 'Refusé',
};

export interface AbandonContext {
  groupId: string;
  scopeUniteId?: string | null;
  submittedByUserId?: string | null;
}

export interface Abandon {
  id: string;
  group_id: string;
  donateur: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  amount_cents: number;
  date_depense: string;
  nature: string;
  unite_id: string | null;
  annee_fiscale: string;
  status: AbandonStatus;
  motif_refus: string | null;
  sent_to_national_at: string | null;
  cerfa_emis: number;
  cerfa_emis_at: string | null;
  notes: string | null;
  submitted_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  unite_code?: string | null;
}

export interface ListAbandonsOptions {
  annee_fiscale?: string;
  donateur?: string;
  status?: AbandonStatus | AbandonStatus[];
  limit?: number;
}

export async function listAbandons(
  { groupId, scopeUniteId, submittedByUserId }: AbandonContext,
  options: ListAbandonsOptions = {},
): Promise<Abandon[]> {
  const conditions: string[] = ['a.group_id = ?'];
  const values: unknown[] = [groupId];

  if (scopeUniteId) {
    conditions.push('a.unite_id = ?');
    values.push(scopeUniteId);
  }
  if (submittedByUserId) {
    conditions.push('a.submitted_by_user_id = ?');
    values.push(submittedByUserId);
  }
  if (options.annee_fiscale) {
    conditions.push('a.annee_fiscale = ?');
    values.push(options.annee_fiscale);
  }
  if (options.donateur) {
    conditions.push('a.donateur LIKE ?');
    values.push(`%${options.donateur}%`);
  }
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    if (statuses.length > 0) {
      conditions.push(`a.status IN (${statuses.map(() => '?').join(', ')})`);
      values.push(...statuses);
    }
  }

  return await getDb()
    .prepare(
      `SELECT a.*, u.code as unite_code
       FROM abandons_frais a
       LEFT JOIN unites u ON u.id = a.unite_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all<Abandon>(...values, options.limit ?? 50);
}

export async function getAbandon(
  { groupId }: AbandonContext,
  id: string,
): Promise<Abandon | null> {
  return (
    (await getDb()
      .prepare(
        `SELECT a.*, u.code as unite_code
         FROM abandons_frais a
         LEFT JOIN unites u ON u.id = a.unite_id
         WHERE a.id = ? AND a.group_id = ?`,
      )
      .get<Abandon>(id, groupId)) ?? null
  );
}

export interface CreateAbandonInput {
  donateur: string;
  prenom?: string | null;
  nom?: string | null;
  email?: string | null;
  amount_cents: number;
  date_depense: string;
  nature: string;
  unite_id?: string | null;
  annee_fiscale: string;
  notes?: string | null;
  submitted_by_user_id?: string | null;
}

export async function createAbandon(
  { groupId }: AbandonContext,
  input: CreateAbandonInput,
): Promise<Abandon> {
  const db = getDb();
  const id = await nextId('ABF');
  const now = currentTimestamp();

  await db
    .prepare(
      `INSERT INTO abandons_frais (
         id, group_id, donateur, prenom, nom, email, amount_cents,
         date_depense, nature, unite_id, annee_fiscale, status, notes,
         submitted_by_user_id, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'a_traiter', ?, ?, ?, ?)`,
    )
    .run(
      id,
      groupId,
      input.donateur,
      nullIfEmpty(input.prenom),
      nullIfEmpty(input.nom),
      nullIfEmpty(input.email),
      input.amount_cents,
      input.date_depense,
      input.nature,
      nullIfEmpty(input.unite_id),
      input.annee_fiscale,
      nullIfEmpty(input.notes),
      nullIfEmpty(input.submitted_by_user_id),
      now,
      now,
    );

  return (await db.prepare('SELECT * FROM abandons_frais WHERE id = ?').get<Abandon>(id))!;
}

export interface UpdateAbandonInput {
  status?: AbandonStatus;
  motif_refus?: string | null;
  sent_to_national_at?: string | null;
  cerfa_emis?: boolean;
  cerfa_emis_at?: string | null;
  notes?: string | null;
}

export async function updateAbandon(
  { groupId }: AbandonContext,
  id: string,
  patch: UpdateAbandonInput,
): Promise<Abandon | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.status !== undefined) {
    sets.push('status = ?');
    values.push(patch.status);
  }
  if (patch.motif_refus !== undefined) {
    sets.push('motif_refus = ?');
    values.push(patch.motif_refus);
  }
  if (patch.sent_to_national_at !== undefined) {
    sets.push('sent_to_national_at = ?');
    values.push(patch.sent_to_national_at);
  }
  if (patch.cerfa_emis !== undefined) {
    sets.push('cerfa_emis = ?');
    values.push(patch.cerfa_emis ? 1 : 0);
  }
  if (patch.cerfa_emis_at !== undefined) {
    sets.push('cerfa_emis_at = ?');
    values.push(patch.cerfa_emis_at);
  }
  if (patch.notes !== undefined) {
    sets.push('notes = ?');
    values.push(patch.notes);
  }

  if (sets.length === 0) {
    return (
      (await getDb()
        .prepare('SELECT * FROM abandons_frais WHERE id = ? AND group_id = ?')
        .get<Abandon>(id, groupId)) ?? null
    );
  }

  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = await getDb()
    .prepare(`UPDATE abandons_frais SET ${sets.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return (await getDb().prepare('SELECT * FROM abandons_frais WHERE id = ?').get<Abandon>(id))!;
}

// Validation des transitions de status. Refusé est terminal (sauf si on
// veut ré-ouvrir, à voir plus tard).
const ALLOWED_TRANSITIONS: Record<AbandonStatus, AbandonStatus[]> = {
  a_traiter: ['valide', 'refuse'],
  valide: ['envoye_national', 'refuse'],
  envoye_national: [],
  refuse: [],
};

export function isAllowedAbandonTransition(
  from: AbandonStatus,
  to: AbandonStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
