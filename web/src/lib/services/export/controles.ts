// Contrôles de cohérence d'un exercice : ils renvoient des LISTES, pas des
// compteurs — l'export doit pouvoir nommer ce qui manque. Aucun contrôle ne
// bloque l'export : ils décrivent.
//
// `db` et `groupId` sont des paramètres, jamais des imports globaux : ces
// fonctions tournent aussi bien depuis un script CLI (pas de session HTTP)
// que depuis une server action.
import type { DbWrapper } from '../../db';
import { formatAmount } from '../../format';
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
    | 'feuille_non_reproduite'
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

export async function controleDepotsOrphelins(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
  options: { cumulatif?: boolean } = {},
): Promise<Controle> {
  // `cumulatif` omet la borne basse : un dépôt orphelin jamais rattaché doit
  // continuer de bloquer indéfiniment (cf. /cloture, qui vérifie "rien ne
  // traîne", pas "rien n'est apparu ce mois-ci"). L'export d'exercice, lui,
  // reste borné à la période — un dépôt orphelin d'un exercice précédent
  // relève du rapport de CET exercice-là, pas de celui-ci.
  const rows = await db
    .prepare(
      `SELECT id, titre, amount_cents, date_estimee, created_at, statut
         FROM depots_justificatifs
        WHERE group_id = ?
          AND ecriture_id IS NULL
          AND remboursement_id IS NULL
          AND statut <> 'rejete'
          ${options.cumulatif ? '' : 'AND COALESCE(date_estimee, created_at) >= ?'}
          AND COALESCE(date_estimee, created_at) <= ?
        ORDER BY COALESCE(date_estimee, created_at), id`,
    )
    .all<{
      id: string;
      titre: string | null;
      amount_cents: number | null;
      date_estimee: string | null;
      created_at: string | null;
      statut: string;
    }>(groupId, ...(options.cumulatif ? [] : [bornes.debut]), bornes.finInclusiveTs);

  return {
    cle: 'depot_orphelin',
    titre: 'Dépôts rattachés à rien',
    lignes: rows.map((r) => ({
      id: r.id,
      date: r.date_estimee ?? (r.created_at ? r.created_at.slice(0, 10) : null),
      libelle: r.titre ?? '',
      montantCents: r.amount_cents ?? 0,
      detail: `statut ${r.statut}`,
    })),
  };
}

// Les écritures `supprimee_cw` et `agrege_remplace` sont des états terminaux
// normaux du miroir (supprimée côté CW, agrégat DSP2 remplacé par ses
// sous-lignes) : ce ne sont pas des écarts à corriger.
const STATUTS_TERMINAUX = ['mirror', 'supprimee_cw', 'agrege_remplace'];

interface RowEcartMiroir {
  id: string;
  date_ecriture: string | null;
  description: string | null;
  amount_cents: number;
  status: string;
}

export async function controleEcartsMiroir(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
): Promise<Controle[]> {
  const placeholders = STATUTS_TERMINAUX.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT id, date_ecriture, description, amount_cents, status
         FROM ecritures
        WHERE group_id = ?
          AND date_ecriture >= ?
          AND date_ecriture <= ?
          AND status NOT IN (${placeholders})
        ORDER BY date_ecriture, id`,
    )
    .all<RowEcartMiroir>(groupId, bornes.debut, bornes.fin, ...STATUTS_TERMINAUX);

  const toLigne = (r: RowEcartMiroir, detail: string): LigneControle => ({
    id: r.id,
    date: r.date_ecriture,
    libelle: r.description ?? '',
    montantCents: r.amount_cents,
    detail,
  });

  const lignes: LigneControle[] = rows.map((r) => toLigne(r, `statut ${r.status}`));

  return [
    {
      cle: 'ecart_miroir',
      titre: 'Écritures non matérialisées dans Comptaweb',
      lignes,
    },
    {
      cle: 'ecriture_divergente',
      titre: 'Écritures divergentes (Baloo ≠ Comptaweb)',
      lignes: rows.filter((r) => r.status === 'divergent').map((r) => toLigne(r, 'divergent')),
    },
  ];
}

/**
 * Fichiers référencés en base et introuvables dans le store. Seul contrôle
 * exigeant de la I/O : `existe` est injecté pour que la logique reste pure
 * et testable, et que l'accès réseau reste dans le script appelant.
 */
export async function controleBlobsManquants(
  justifs: Array<{ id: string; file_path: string; original_filename: string | null }>,
  existe: (filePath: string) => Promise<boolean>,
): Promise<Controle> {
  const lignes: LigneControle[] = [];
  for (const j of justifs) {
    if (!(await existe(j.file_path))) {
      lignes.push({
        id: j.id,
        date: null,
        libelle: j.original_filename ?? j.file_path,
        montantCents: 0,
        detail: j.file_path,
      });
    }
  }
  return { cle: 'blob_manquant', titre: 'Fichiers introuvables dans le store', lignes };
}

/**
 * Tous les contrôles réalisables sans I/O, dans un ordre stable (celui de
 * lecture du rapport). Le contrôle `blob_manquant` n'est pas ici : il exige
 * d'interroger le store de fichiers, et vit donc côté script.
 */
export async function rapportControles(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
): Promise<Controle[]> {
  const [sansJustif, sansPdf, orphelins, miroir] = await Promise.all([
    controleEcrituresSansJustif(db, groupId, bornes),
    controleRembsSansPdf(db, groupId, bornes),
    controleDepotsOrphelins(db, groupId, bornes),
    controleEcartsMiroir(db, groupId, bornes),
  ]);
  return [sansJustif, sansPdf, orphelins, ...miroir];
}

/** Rendu texte du rapport, réutilisé tel quel en tête du README.md du dossier. */
export function formatRapportTexte(controles: Controle[], bornes: BornesExercice): string {
  const out: string[] = [`Contrôles de cohérence — exercice ${bornes.exercice} (${bornes.debut} → ${bornes.fin})`, ''];
  let total = 0;
  for (const c of controles) {
    total += c.lignes.length;
    if (c.lignes.length === 0) {
      out.push(`✅ ${c.titre} : rien à signaler`);
      continue;
    }
    out.push(`⚠️  ${c.titre} (${c.lignes.length})`);
    for (const l of c.lignes) {
      const detail = l.detail ? ` — ${l.detail}` : '';
      out.push(`     ${l.date ?? '?'}  ${l.id}  ${formatAmount(l.montantCents)}  ${l.libelle}${detail}`);
    }
    out.push('');
  }
  if (total === 0) out.push('', 'Rien à signaler : l’exercice est prêt à être clos.');
  return out.join('\n');
}
