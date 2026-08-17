// Agrégats bancaires supplantés par leur détail DSP2.
//
// Module volontairement SANS dépendance auth (pas de `getCurrentContext`) : il
// ne touche que la BDD, ce qui le rend testable directement — cf.
// `inbox-agregats-supplantes.test.ts`.
//
// Contexte : la banque publie le détail commerçant d'un « PAIEMENT C. PROC »
// après coup (à la clôture du relevé mensuel). Le draft agrégé créé au premier
// scrape est alors remplacé par un draft par sous-ligne. `planLineHeal` résorbe
// le cas simple (une seule sous-ligne → l'agrégat prend son identité), mais dès
// qu'il y en a PLUSIEURS et que l'agrégat porte des pièces, personne ne peut
// trancher à la place du trésorier : il doit reventiler lui-même. Le doublon
// est alors laissé en place — et doit donc être VISIBLE, sans quoi il compte
// double en silence (cas ECR-2026-472, ligne 19130340, découvert le 2026-08-17
// des semaines après coup).

import { getDb, type DbWrapper } from '../db';

export interface AgregatSupplante {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  ligne_bancaire_id: number;
  /** Nombre de drafts « sous-ligne » qui remplacent cet agrégat. */
  nb_sous_lignes: number;
}

export async function listAgregatsSupplantes(
  { groupId }: { groupId: string },
  db: DbWrapper = getDb(),
): Promise<AgregatSupplante[]> {
  return await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.ligne_bancaire_id,
              (SELECT COUNT(*) FROM ecritures s
                WHERE s.group_id = e.group_id
                  AND s.ligne_bancaire_id = e.ligne_bancaire_id
                  AND s.ligne_bancaire_sous_index IS NOT NULL) AS nb_sous_lignes
         FROM ecritures e
        WHERE e.group_id = ?
          AND e.status = 'draft'
          AND e.ligne_bancaire_id IS NOT NULL
          AND e.ligne_bancaire_sous_index IS NULL
          AND EXISTS (SELECT 1 FROM ecritures s
                       WHERE s.group_id = e.group_id
                         AND s.ligne_bancaire_id = e.ligne_bancaire_id
                         AND s.ligne_bancaire_sous_index IS NOT NULL)
        ORDER BY e.date_ecriture DESC, e.id DESC`,
    )
    .all<AgregatSupplante>(groupId);
}
