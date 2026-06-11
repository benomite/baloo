import { getDb } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';
import { ensureCampsSchema, getCamp, type CampContext } from './camps';
import {
  validateCloture,
  buildAvancesSummary,
  type AvanceStatut,
  type AvancesSummary,
} from './camp-avances-logic';

// Avances de trésorerie d'un camp (spec 2026-06-10, A2). Une avance est
// un transfert vers le chef, PAS une dépense du camp — l'écriture du
// virement (ecriture_id, traçabilité) ne doit pas être imputée à
// l'activité du camp, sinon double comptage avec les tickets.

let schemaEnsured = false;
export async function ensureAvancesSchema(): Promise<void> {
  if (schemaEnsured) return;
  // FK vers camps : la table camps doit exister d'abord.
  await ensureCampsSchema();
  await getDb().exec(`
    CREATE TABLE IF NOT EXISTS avances_camp (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      camp_id TEXT NOT NULL REFERENCES camps(id),
      beneficiaire TEXT NOT NULL,
      montant_cents INTEGER NOT NULL,
      date_versement TEXT,
      mode TEXT NOT NULL DEFAULT 'virement',
      ecriture_id TEXT REFERENCES ecritures(id),
      statut TEXT NOT NULL DEFAULT 'versee',
      montant_rendu_cents INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_avances_camp ON avances_camp(camp_id);
  `);
  schemaEnsured = true;
}

export const AVANCE_MODES = ['virement', 'especes'] as const;
export type AvanceMode = (typeof AVANCE_MODES)[number];

export interface AvanceCamp {
  id: string;
  group_id: string;
  camp_id: string;
  beneficiaire: string;
  montant_cents: number;
  date_versement: string | null;
  mode: AvanceMode;
  ecriture_id: string | null;
  statut: AvanceStatut;
  montant_rendu_cents: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // joints (écriture du virement, traçabilité)
  ecriture_description?: string | null;
  ecriture_date?: string | null;
  ecriture_activite_id?: string | null;
  // calculé : l'écriture du virement est imputée à l'activité du camp
  // -> double comptage avec les tickets du chef, à corriger.
  double_comptage?: boolean;
}

export interface CampAvances {
  avances: AvanceCamp[];
  summary: AvancesSummary;
}

export async function createAvance(
  ctx: CampContext,
  input: {
    camp_id: string;
    beneficiaire: string;
    montant_cents: number;
    date_versement?: string | null;
    mode: AvanceMode;
    ecriture_id?: string | null;
    notes?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  await ensureAvancesSchema();
  const camp = await getCamp(ctx, input.camp_id);
  if (!camp) return { ok: false, error: 'Camp introuvable.' };
  if (!(AVANCE_MODES as readonly string[]).includes(input.mode)) {
    return { ok: false, error: `Mode invalide : ${input.mode}.` };
  }
  if (!Number.isInteger(input.montant_cents) || input.montant_cents <= 0) {
    return { ok: false, error: 'Montant invalide.' };
  }
  // nextId historique ne scanne pas les nouvelles tables (piège #11).
  const id = await nextIdOn(getDb(), 'AVC', { tables: ['avances_camp'] });
  await getDb()
    .prepare(
      `INSERT INTO avances_camp (id, group_id, camp_id, beneficiaire, montant_cents, date_versement, mode, ecriture_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, ctx.groupId, input.camp_id, input.beneficiaire.trim(),
      input.montant_cents, input.date_versement || null, input.mode,
      input.ecriture_id || null, input.notes?.trim() || null,
    );
  return { ok: true };
}

export async function listAvancesForCamp(
  ctx: CampContext,
  campId: string,
): Promise<CampAvances | null> {
  await ensureAvancesSchema();
  const camp = await getCamp(ctx, campId);
  if (!camp) return null;
  const rows = await getDb()
    .prepare(
      `SELECT a.*, e.description AS ecriture_description,
              e.date_ecriture AS ecriture_date, e.activite_id AS ecriture_activite_id
       FROM avances_camp a
       LEFT JOIN ecritures e ON e.id = a.ecriture_id
       WHERE a.group_id = ? AND a.camp_id = ?
       ORDER BY COALESCE(a.date_versement, a.created_at) DESC, a.id DESC`,
    )
    .all<AvanceCamp>(ctx.groupId, campId);
  const avances = rows.map((a) => ({
    ...a,
    double_comptage:
      a.ecriture_activite_id != null &&
      a.ecriture_activite_id === camp.activite_id,
  }));
  return { avances, summary: buildAvancesSummary(avances) };
}

async function getAvance(
  ctx: CampContext,
  id: string,
): Promise<AvanceCamp | null> {
  await ensureAvancesSchema();
  const avance = await getDb()
    .prepare('SELECT * FROM avances_camp WHERE id = ? AND group_id = ?')
    .get<AvanceCamp>(id, ctx.groupId);
  if (!avance) return null;
  // Scope chef (lecture) : porté par le camp.
  const camp = await getCamp(ctx, avance.camp_id);
  if (!camp) return null;
  return avance;
}

export async function cloturerAvance(
  ctx: CampContext,
  id: string,
  montantRenduCents: number,
): Promise<{ ok: boolean; error?: string; campId?: string }> {
  const avance = await getAvance(ctx, id);
  if (!avance) return { ok: false, error: 'Avance introuvable.' };
  if (avance.statut !== 'versee') {
    return { ok: false, error: 'Avance déjà clôturée.', campId: avance.camp_id };
  }
  const err = validateCloture(avance.montant_cents, montantRenduCents);
  if (err) return { ok: false, error: err, campId: avance.camp_id };
  await getDb()
    .prepare(
      `UPDATE avances_camp SET statut = 'cloturee', montant_rendu_cents = ?, updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(montantRenduCents, currentTimestamp(), id, ctx.groupId);
  return { ok: true, campId: avance.camp_id };
}

// Correction d'erreur : rouvrir une avance clôturée par mégarde. Le rendu
// est remis à null (il sera ressaisi à la vraie clôture).
export async function rouvrirAvance(
  ctx: CampContext,
  id: string,
): Promise<{ ok: boolean; error?: string; campId?: string }> {
  const avance = await getAvance(ctx, id);
  if (!avance) return { ok: false, error: 'Avance introuvable.' };
  if (avance.statut !== 'cloturee') {
    return { ok: false, error: 'Avance non clôturée.', campId: avance.camp_id };
  }
  await getDb()
    .prepare(
      `UPDATE avances_camp SET statut = 'versee', montant_rendu_cents = NULL, updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(currentTimestamp(), id, ctx.groupId);
  return { ok: true, campId: avance.camp_id };
}

// Écritures candidates au lien « virement de l'avance » (traçabilité) :
// dernières dépenses du groupe, pour le select du formulaire admin.
export interface EcritureCandidate {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
}

export async function listEcrituresCandidatesAvance(
  ctx: CampContext,
): Promise<EcritureCandidate[]> {
  return await getDb()
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents
       FROM ecritures e
       WHERE e.group_id = ? AND e.type = 'depense'
       ORDER BY e.date_ecriture DESC, e.id DESC
       LIMIT 30`,
    )
    .all<EcritureCandidate>(ctx.groupId);
}
