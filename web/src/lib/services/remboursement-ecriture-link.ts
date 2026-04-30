import { getDb } from '../db';

// Service dédié à la liaison `remboursements.ecriture_id`. Trouve les
// écritures candidates au moment où un trésorier veut associer une
// demande à son écriture comptable de virement, et applique le lien.

export interface EcritureCandidate {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  unite_code: string | null;
  status: string;
}

const DATE_WINDOW_DAYS = 120;

// Liste les écritures candidates pour une rembs : même groupe, type
// `dépense`, montant exact, fenêtre date ±120j, pas déjà liées à une
// AUTRE rembs (on garde la candidate si elle est déjà liée à la
// rembs courante — utile pour afficher l'écriture actuellement liée).
export async function findEcritureCandidatesForRembs(
  groupId: string,
  rembsId: string,
): Promise<EcritureCandidate[]> {
  const db = getDb();

  const rembs = await db
    .prepare(
      `SELECT amount_cents, date_depense
       FROM remboursements
       WHERE id = ? AND group_id = ?`,
    )
    .get<{ amount_cents: number; date_depense: string | null }>(rembsId, groupId);

  if (!rembs || !rembs.date_depense) return [];

  const baseDate = new Date(rembs.date_depense).getTime();
  const fromDate = new Date(baseDate - DATE_WINDOW_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const toDate = new Date(baseDate + DATE_WINDOW_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  return await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.status,
              u.code AS unite_code
       FROM ecritures e
       LEFT JOIN unites u ON u.id = e.unite_id
       WHERE e.group_id = ?
         AND e.type = 'depense'
         AND e.amount_cents = ?
         AND e.date_ecriture BETWEEN ? AND ?
         AND e.id NOT IN (
           SELECT ecriture_id FROM remboursements
           WHERE ecriture_id IS NOT NULL AND id != ?
         )
       ORDER BY e.date_ecriture, e.id
       LIMIT 30`,
    )
    .all<EcritureCandidate>(groupId, rembs.amount_cents, fromDate, toDate, rembsId);
}

// Applique le lien rembs → écriture. Vérifie en passant que :
//  - l'écriture existe et appartient au même groupe.
//  - l'écriture n'est pas déjà liée à une autre rembs.
// Retourne `{ ok: true }` ou `{ ok: false, error: '...' }` pour que
// la server action puisse rediriger avec le bon message.
export async function setRembsEcritureLink(
  groupId: string,
  rembsId: string,
  ecritureId: string | null,
): Promise<{ ok: true; previous: string | null } | { ok: false; error: string }> {
  const db = getDb();

  const current = await db
    .prepare('SELECT ecriture_id FROM remboursements WHERE id = ? AND group_id = ?')
    .get<{ ecriture_id: string | null }>(rembsId, groupId);
  if (!current) return { ok: false, error: 'Demande introuvable.' };

  if (ecritureId) {
    const ecriture = await db
      .prepare('SELECT id FROM ecritures WHERE id = ? AND group_id = ?')
      .get<{ id: string }>(ecritureId, groupId);
    if (!ecriture) return { ok: false, error: `Écriture ${ecritureId} introuvable.` };

    const conflict = await db
      .prepare(
        `SELECT id FROM remboursements
         WHERE ecriture_id = ? AND id != ?`,
      )
      .get<{ id: string }>(ecritureId, rembsId);
    if (conflict) {
      return {
        ok: false,
        error: `Écriture déjà liée à la demande ${conflict.id}.`,
      };
    }
  }

  await db
    .prepare(
      `UPDATE remboursements
       SET ecriture_id = ?, updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(ecritureId, new Date().toISOString(), rembsId, groupId);

  return { ok: true, previous: current.ecriture_id };
}
