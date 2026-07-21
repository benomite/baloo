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
  linked_count: number;
}

const DATE_WINDOW_DAYS = 365;

// Liste les écritures candidates pour une rembs : même groupe, type
// `dépense`, fenêtre date ±365j (si date_depense connue). Pas de filtre
// de montant (virement groupé possible) ni d'exclusion des écritures
// déjà liées à une autre rembs (many-to-one autorisé : une écriture de
// virement groupé peut couvrir plusieurs demandes).
export async function findEcritureCandidatesForRembs(
  groupId: string,
  rembsId: string,
): Promise<EcritureCandidate[]> {
  const db = getDb();

  const rembs = await db
    .prepare(
      `SELECT amount_cents, total_cents, date_depense
       FROM remboursements
       WHERE id = ? AND group_id = ?`,
    )
    .get<{ amount_cents: number; total_cents: number | null; date_depense: string | null }>(rembsId, groupId);

  if (!rembs) return [];
  const target = Math.abs(rembs.total_cents ?? rembs.amount_cents ?? 0);

  const conditions: string[] = ["e.group_id = ?", "e.type = 'depense'"];
  const params: unknown[] = [groupId];

  // Fenêtre date seulement si la demande a une date d'appui.
  if (rembs.date_depense) {
    const baseDate = new Date(rembs.date_depense).getTime();
    const fromDate = new Date(baseDate - DATE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const toDate = new Date(baseDate + DATE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    conditions.push("e.date_ecriture BETWEEN ? AND ?");
    params.push(fromDate, toDate);
  }

  // Plus de filtre de montant ni d'exclusion des écritures déjà liées :
  // un virement groupé (montant ≠ total demande) et une écriture déjà
  // rattachée à une autre demande doivent apparaître. Tri : proximité de
  // montant en tête (match exact d'abord), puis date décroissante.
  return await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.status,
              u.code AS unite_code,
              (SELECT COUNT(*) FROM remboursements r WHERE r.ecriture_id = e.id) AS linked_count
       FROM ecritures e
       LEFT JOIN unites u ON u.id = e.unite_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ABS(ABS(e.amount_cents) - ?) ASC, e.date_ecriture DESC
       LIMIT 300`,
    )
    .all<EcritureCandidate>(...params, target);
}

// Applique le lien rembs → écriture. Vérifie en passant que l'écriture
// existe et appartient au même groupe (many-to-one autorisé : plusieurs
// demandes peuvent pointer vers la même écriture de virement groupé).
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
  }

  await db
    .prepare(
      `UPDATE remboursements
       SET ecriture_id = ?, updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(ecritureId, new Date().toISOString(), rembsId, groupId);

  // Enrichissement : recopie l'imputation de la demande dans les champs
  // ENCORE VIDES de l'écriture liée (COALESCE → jamais d'écrasement ;
  // `status = 'draft'` → on ne touche pas à une écriture déjà dans CW).
  // NB : la table `remboursements` ne porte que `unite_id` comme imputation
  // structurée (pas de category_id ni activite_id — juste un champ `nature`
  // texte libre). On ne propage donc QUE l'unité.
  if (ecritureId) {
    const remb = await db
      .prepare('SELECT unite_id FROM remboursements WHERE id = ? AND group_id = ?')
      .get<{ unite_id: string | null }>(rembsId, groupId);
    if (remb?.unite_id) {
      await db
        .prepare(
          `UPDATE ecritures SET unite_id = COALESCE(unite_id, ?), updated_at = ?
           WHERE id = ? AND group_id = ? AND status = 'draft'`,
        )
        .run(remb.unite_id, new Date().toISOString(), ecritureId, groupId);
    }
  }

  return { ok: true, previous: current.ecriture_id };
}

export interface RembsCoverage {
  nbDemandes: number;
  sommeDemandesCents: number;    // Σ |total demande| des demandes liées
  montantVirementCents: number;  // |montant de l'écriture|
  resteCents: number;            // montantVirement - sommeDemandes (peut être < 0)
  depasse: boolean;              // sommeDemandes > montantVirement
}

// Pur : couverture d'un virement par les demandes qui lui sont liées.
// Tout en valeur absolue (totaux demande positifs ; le signe éventuel de
// l'écriture ne doit pas fausser le calcul).
export function computeRembsCoverage(
  montantVirementCents: number,
  rembsTotalsCents: number[],
): RembsCoverage {
  const montant = Math.abs(montantVirementCents);
  const somme = rembsTotalsCents.reduce((s, t) => s + Math.abs(t), 0);
  return {
    nbDemandes: rembsTotalsCents.length,
    sommeDemandesCents: somme,
    montantVirementCents: montant,
    resteCents: montant - somme,
    depasse: somme > montant,
  };
}

// Variante BDD : lit le montant de l'écriture + les totaux des demandes
// liées, puis délègue à computeRembsCoverage.
export async function getEcritureRembsCoverage(
  groupId: string,
  ecritureId: string,
): Promise<RembsCoverage> {
  const db = getDb();
  const ecr = await db
    .prepare('SELECT amount_cents FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ amount_cents: number }>(ecritureId, groupId);
  const rows = await db
    .prepare(
      `SELECT COALESCE(total_cents, amount_cents) AS total
       FROM remboursements
       WHERE group_id = ? AND ecriture_id = ?`,
    )
    .all<{ total: number }>(groupId, ecritureId);
  return computeRembsCoverage(ecr?.amount_cents ?? 0, rows.map((r) => r.total ?? 0));
}
