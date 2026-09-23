// Contrôles de cohérence d'un exercice : ils renvoient des LISTES, pas des
// compteurs — l'export doit pouvoir nommer ce qui manque. Aucun contrôle ne
// bloque l'export : ils décrivent.
//
// `db` et `groupId` sont des paramètres, jamais des imports globaux : ces
// fonctions tournent aussi bien depuis un script CLI (pas de session HTTP)
// que depuis une server action.
import type { DbWrapper } from '../../db';
import type { BornesExercice } from './bornes';

export interface LigneControle {
  id: string;
  date: string | null;
  libelle: string;
  montantCents: number;
  detail: string | null;
}

export interface Controle {
  cle:
    | 'ecriture_sans_justif'
    | 'remb_sans_pdf'
    | 'depot_orphelin'
    | 'blob_manquant'
    | 'ecart_miroir'
    | 'ecriture_divergente';
  titre: string;
  lignes: LigneControle[];
}

export async function controleEcrituresSansJustif(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
): Promise<Controle> {
  const rows = await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents
         FROM ecritures e
        WHERE e.group_id = ?
          AND e.type = 'depense'
          AND e.justif_attendu = 1
          AND e.date_ecriture >= ?
          AND e.date_ecriture <= ?
          AND NOT EXISTS (
            SELECT 1 FROM justificatifs j
             WHERE j.entity_type = 'ecriture'
               AND j.entity_id = e.id
               AND j.obsolete_at IS NULL
          )
        ORDER BY e.date_ecriture, e.id`,
    )
    .all<{ id: string; date_ecriture: string | null; description: string | null; amount_cents: number }>(
      groupId,
      bornes.debut,
      bornes.fin,
    );

  return {
    cle: 'ecriture_sans_justif',
    titre: 'Écritures sans justificatif',
    lignes: rows.map((r) => ({
      id: r.id,
      date: r.date_ecriture,
      libelle: r.description ?? '',
      montantCents: r.amount_cents,
      detail: null,
    })),
  };
}

export async function controleRembsSansPdf(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
): Promise<Controle> {
  const rows = await db
    .prepare(
      `SELECT r.id, r.date_depense, r.created_at, r.demandeur, r.total_cents, r.status
         FROM remboursements r
        WHERE r.group_id = ?
          AND r.status IN ('virement_effectue', 'termine')
          AND COALESCE(r.date_depense, r.created_at) >= ?
          AND COALESCE(r.date_depense, r.created_at) <= ?
          AND NOT EXISTS (
            SELECT 1 FROM justificatifs j
             WHERE j.entity_type = 'remboursement_feuille'
               AND j.entity_id = r.id
               AND j.obsolete_at IS NULL
          )
        ORDER BY COALESCE(r.date_depense, r.created_at), r.id`,
    )
    .all<{
      id: string;
      date_depense: string | null;
      created_at: string | null;
      demandeur: string | null;
      total_cents: number;
      status: string;
    }>(groupId, bornes.debut, bornes.finInclusiveTs);

  return {
    cle: 'remb_sans_pdf',
    titre: 'Remboursements aboutis sans feuille signée',
    lignes: rows.map((r) => ({
      id: r.id,
      date: r.date_depense ?? (r.created_at ? r.created_at.slice(0, 10) : null),
      libelle: r.demandeur ?? '',
      montantCents: r.total_cents,
      detail: `statut ${r.status}`,
    })),
  };
}
