import { getDb } from '../db';
import { ventilateDraft } from './ecritures-ventilate';
import type { EcritureContext } from './ecritures';
import type { VentilationInput } from './ecritures-create';
import { currentTimestamp } from '../ids';
import { logError } from '../log';

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

  // Masque les sous-lignes internes d'un groupe de ventilation (pas de
  // pièce, jamais candidates) : une demande ne peut se lier qu'à la TÊTE
  // du virement, jamais à une ligne-enfant. Une écriture non ventilée
  // (ventilation_group_id NULL) reste candidate ; une tête déjà porteuse
  // d'une rembs (EXISTS) reste candidate aussi (many-to-one).
  conditions.push(
    "(e.ventilation_group_id IS NULL OR EXISTS (SELECT 1 FROM remboursements r WHERE r.ecriture_id = e.id))",
  );

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

  // (Re)ventilation auto du virement selon ses demandes liées. Best-effort :
  // une erreur ici ne doit jamais faire échouer la liaison. Absorbe l'ancien
  // enrichissement COALESCE `unite_id` (cas « demande unique jamais ventilée »).
  const target = ecritureId ?? current.ecriture_id;
  if (target) {
    try {
      await syncEcritureVentilationFromRembs(groupId, target);
    } catch (err) {
      logError('remboursements', 'Ventilation auto du virement échouée', err);
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
// liées, puis délègue à computeRembsCoverage. Group-aware : une fois
// ventilée, la tête ne porte plus qu'une part du virement — le
// dénominateur doit être le total du `ventilation_group_id` (= le
// virement d'origine), pas le seul `amount_cents` de la tête.
export async function getEcritureRembsCoverage(
  groupId: string,
  ecritureId: string,
): Promise<RembsCoverage> {
  const db = getDb();
  const ecr = await db
    .prepare('SELECT amount_cents, ventilation_group_id FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ amount_cents: number; ventilation_group_id: string | null }>(ecritureId, groupId);
  let virement = ecr?.amount_cents ?? 0;
  if (ecr?.ventilation_group_id) {
    const g = await db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS t
         FROM ecritures WHERE group_id = ? AND ventilation_group_id = ?`,
      )
      .get<{ t: number }>(groupId, ecr.ventilation_group_id);
    virement = g?.t ?? virement;
  }
  const rows = await db
    .prepare(
      `SELECT COALESCE(total_cents, amount_cents) AS total
       FROM remboursements
       WHERE group_id = ? AND ecriture_id = ?`,
    )
    .all<{ total: number }>(groupId, ecritureId);
  return computeRembsCoverage(virement, rows.map((r) => r.total ?? 0));
}

// (Re)ventile une écriture de virement selon les demandes qui lui sont liées.
// Best-effort — appelée après chaque lien/délien. Grain canonique = la
// ventilation : une sous-ligne par demande (sur son unité) + une ligne « reste
// à imputer » si la somme des demandes < montant du virement.
//
// Invariant d'ancrage : les remboursements restent épinglés à la TÊTE du
// groupe (jamais réaffectés). `ventilateDraft` préserve l'id de tête, les
// enfants n'ont aucune pièce → re-ventilation possible sans casser le lien N→1.
export async function syncEcritureVentilationFromRembs(
  groupId: string,
  ecritureId: string,
): Promise<void> {
  const db = getDb();

  const ecr = await db
    .prepare(
      `SELECT amount_cents, status, comptaweb_ecriture_id, ventilation_group_id
       FROM ecritures WHERE id = ? AND group_id = ?`,
    )
    .get<{
      amount_cents: number;
      status: string;
      comptaweb_ecriture_id: number | null;
      ventilation_group_id: string | null;
    }>(ecritureId, groupId);

  // On ne touche jamais une écriture matérialisée dans Comptaweb.
  if (!ecr || ecr.status !== 'draft' || ecr.comptaweb_ecriture_id !== null) return;

  // Total du virement = Σ du groupe (la tête peut déjà porter une part), sinon
  // son propre montant. Invariant : Σ groupe = montant du virement d'origine.
  let virement = Math.abs(ecr.amount_cents);
  if (ecr.ventilation_group_id) {
    const g = await db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS t
         FROM ecritures WHERE group_id = ? AND ventilation_group_id = ?`,
      )
      .get<{ t: number }>(groupId, ecr.ventilation_group_id);
    virement = Math.abs(g?.t ?? ecr.amount_cents);
  }

  // Demandes liées, tri déterministe.
  const rembs = await db
    .prepare(
      `SELECT unite_id, COALESCE(total_cents, amount_cents) AS total
       FROM remboursements
       WHERE group_id = ? AND ecriture_id = ?
       ORDER BY created_at, id`,
    )
    .all<{ unite_id: string | null; total: number | null }>(groupId, ecritureId);

  const lignes: VentilationInput[] = rembs.map((r) => ({
    amount_cents: Math.abs(r.total ?? 0),
    unite_id: r.unite_id ?? null,
    category_id: null,
    activite_id: null,
  }));

  const somme = lignes.reduce((s, l) => s + l.amount_cents, 0);
  const reste = virement - somme;

  // Dépassement : on ne fabrique pas de ligne négative, on laisse tel quel.
  if (reste < 0) return;
  if (reste > 0) {
    lignes.push({ amount_cents: reste, unite_id: null, category_id: null, activite_id: null });
  }

  const ctx: EcritureContext = { groupId };

  if (lignes.length >= 2) {
    await ventilateDraft(ctx, ecritureId, lignes);
    return;
  }

  if (lignes.length === 1) {
    if (ecr.ventilation_group_id) {
      // Repli d'un groupe existant vers une mono-ligne.
      await ventilateDraft(ctx, ecritureId, lignes);
    } else {
      // Demande unique jamais ventilée : COALESCE unité (non destructif).
      const u = lignes[0].unite_id;
      if (u) {
        await db
          .prepare(
            `UPDATE ecritures SET unite_id = COALESCE(unite_id, ?), updated_at = ?
             WHERE id = ? AND group_id = ? AND status = 'draft'`,
          )
          .run(u, currentTimestamp(), ecritureId, groupId);
      }
    }
  }
  // lignes.length === 0 : virement à 0 sans demande → rien à faire.
}
