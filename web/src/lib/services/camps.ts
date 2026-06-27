import { getDb, type DbWrapper } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';
import { currentExercice, CATEGORIES_HORS_RESULTAT } from './overview';
import { ensureDepotsSchema } from './depots';
import { buildCampBudgetRows, type CampBudgetRows, type CatAmount } from './camp-budget';

// Camps (spec 2026-06-10) : entité légère, vue filtrée de la compta par
// activité Comptaweb. Table lazy-init (pattern depots_justificatifs).

let schemaEnsured = false;
export async function ensureCampsSchema(): Promise<void> {
  if (schemaEnsured) return;
  await getDb().exec(`
    CREATE TABLE IF NOT EXISTS camps (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      name TEXT NOT NULL,
      unite_id TEXT NOT NULL REFERENCES unites(id),
      activite_id TEXT NOT NULL REFERENCES activites(id),
      date_debut TEXT,
      date_fin TEXT,
      statut TEXT NOT NULL DEFAULT 'preparation',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_camps_group ON camps(group_id);
  `);
  schemaEnsured = true;
}

export const CAMP_STATUTS = ['preparation', 'en_cours', 'cloture'] as const;
export type CampStatut = (typeof CAMP_STATUTS)[number];

export interface Camp {
  id: string;
  group_id: string;
  name: string;
  unite_id: string;
  activite_id: string;
  date_debut: string | null;
  date_fin: string | null;
  statut: CampStatut;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // joints
  unite_code?: string | null;
  unite_name?: string | null;
  unite_couleur?: string | null;
  activite_name?: string | null;
}

export interface CampContext {
  groupId: string;
  scopeUniteId?: string | null;
}

export async function createCamp(
  { groupId }: CampContext,
  input: { name: string; unite_id: string; activite_id: string; date_debut?: string | null; date_fin?: string | null; notes?: string | null },
): Promise<Camp> {
  await ensureCampsSchema();
  // `nextId` par défaut scanne une liste de tables historiques qui n'inclut
  // PAS `camps` → renvoyait toujours CAMP-AAAA-001 (UNIQUE violé au 2e camp).
  // On scanne explicitement la table camps (créée par ensureCampsSchema ↑).
  const id = await nextIdOn(getDb(), 'CAMP', { tables: ['camps'] });
  await getDb()
    .prepare(
      `INSERT INTO camps (id, group_id, name, unite_id, activite_id, date_debut, date_fin, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, groupId, input.name.trim(), input.unite_id, input.activite_id,
         input.date_debut || null, input.date_fin || null, input.notes?.trim() || null);
  return (await getCamp({ groupId }, id))!;
}

const CAMP_SELECT = `
  SELECT c.*, u.code AS unite_code, u.name AS unite_name, u.couleur AS unite_couleur,
         a.name AS activite_name
  FROM camps c
  LEFT JOIN unites u ON u.id = c.unite_id
  LEFT JOIN activites a ON a.id = c.activite_id`;

export async function listCamps(ctx: CampContext): Promise<Camp[]> {
  await ensureCampsSchema();
  const conditions = ['c.group_id = ?'];
  const values: unknown[] = [ctx.groupId];
  if (ctx.scopeUniteId) { conditions.push('c.unite_id = ?'); values.push(ctx.scopeUniteId); }
  return await getDb()
    .prepare(`${CAMP_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY COALESCE(c.date_debut, c.created_at) DESC`)
    .all<Camp>(...values);
}

export async function getCamp(ctx: CampContext, id: string): Promise<Camp | null> {
  await ensureCampsSchema();
  const camp = await getDb()
    .prepare(`${CAMP_SELECT} WHERE c.id = ? AND c.group_id = ?`)
    .get<Camp>(id, ctx.groupId);
  if (!camp) return null;
  // Scope chef : un chef ne voit que les camps de son unité.
  if (ctx.scopeUniteId && camp.unite_id !== ctx.scopeUniteId) return null;
  return camp;
}

// Validation de transition côté code (pas de CHECK SQL — cf. AGENTS.md).
export async function updateCampStatut(
  ctx: CampContext, id: string, statut: CampStatut,
): Promise<{ ok: boolean; error?: string }> {
  if (!CAMP_STATUTS.includes(statut)) return { ok: false, error: `Statut invalide : ${statut}.` };
  const camp = await getCamp(ctx, id);
  if (!camp) return { ok: false, error: 'Camp introuvable.' };
  await getDb()
    .prepare('UPDATE camps SET statut = ?, updated_at = ? WHERE id = ? AND group_id = ?')
    .run(statut, currentTimestamp(), id, ctx.groupId);
  return { ok: true };
}

// === Données du dashboard camp ===

export interface EcritureCampRow {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  category_name: string | null;
  has_justificatif: number;
  remboursement_id: string | null;
  justif_attendu: number;
}

export interface DepotCampRow {
  id: string;
  titre: string;
  amount_cents: number | null;
  date_estimee: string | null;
  category_name: string | null;
  submitter_name: string | null;
}

export interface CampDashboard {
  camp: Camp;
  rows: CampBudgetRows;
  ecrituresRecentes: EcritureCampRow[];
  depotsEnAttente: DepotCampRow[];
  justifsManquants: EcritureCampRow[];
  recettes: EcritureCampRow[];
  // Écritures de l'activité SANS branche/pôle (unite_id null) : invisibles
  // de tous les camps (camp = activité × unité) — à signaler.
  sansUniteCount: number;
}

const EXCLUS = CATEGORIES_HORS_RESULTAT.map(() => '?').join(',');

export async function selectCampRecettes(
  db: DbWrapper,
  groupId: string,
  activiteId: string,
  uniteId: string,
): Promise<EcritureCampRow[]> {
  return db.prepare(
    `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type, e.justif_attendu,
            c.name AS category_name,
            EXISTS(SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id) AS has_justificatif,
            (SELECT r.id FROM remboursements r WHERE r.ecriture_id = e.id LIMIT 1) AS remboursement_id
     FROM ecritures e LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.group_id = ? AND e.activite_id = ? AND e.unite_id = ? AND e.type = 'recette'
       AND (e.category_id IS NULL OR e.category_id NOT IN (${EXCLUS}))
     ORDER BY e.date_ecriture DESC, e.id DESC`,
  ).all<EcritureCampRow>(groupId, activiteId, uniteId, ...CATEGORIES_HORS_RESULTAT);
}

export async function getCampDashboard(ctx: CampContext, id: string): Promise<CampDashboard | null> {
  // Assure l'existence de la table depots_justificatifs (lazy-init — cf. AGENTS.md).
  await ensureDepotsSchema();
  const camp = await getCamp(ctx, id);
  if (!camp) return null;
  const db = getDb();
  const saison = currentExercice();

  const budget = await db.prepare(
    `SELECT bl.category_id AS categoryId, c.name AS categoryName, bl.type, SUM(bl.amount_cents) AS amountCents
     FROM budget_lignes bl
     JOIN budgets b ON b.id = bl.budget_id
     LEFT JOIN categories c ON c.id = bl.category_id
     WHERE b.group_id = ? AND b.saison = ? AND bl.activite_id = ? AND bl.unite_id = ?
     GROUP BY bl.category_id, bl.type`,
  ).all<CatAmount & { type: 'depense' | 'recette' }>(ctx.groupId, saison, camp.activite_id, camp.unite_id);

  const ecrDep = await db.prepare(
    `SELECT e.category_id AS categoryId, c.name AS categoryName, SUM(e.amount_cents) AS amountCents
     FROM ecritures e LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.group_id = ? AND e.activite_id = ? AND e.unite_id = ? AND e.type = 'depense'
       AND (e.category_id IS NULL OR e.category_id NOT IN (${EXCLUS}))
     GROUP BY e.category_id`,
  ).all<CatAmount>(ctx.groupId, camp.activite_id, camp.unite_id, ...CATEGORIES_HORS_RESULTAT);

  const depAttente = await db.prepare(
    `SELECT d.category_id AS categoryId, c.name AS categoryName, SUM(COALESCE(d.amount_cents, 0)) AS amountCents
     FROM depots_justificatifs d LEFT JOIN categories c ON c.id = d.category_id
     WHERE d.group_id = ? AND d.activite_id = ? AND d.unite_id = ? AND d.statut = 'a_traiter'
     GROUP BY d.category_id`,
  ).all<CatAmount>(ctx.groupId, camp.activite_id, camp.unite_id);

  const rec = await db.prepare(
    `SELECT COALESCE(SUM(e.amount_cents), 0) AS total FROM ecritures e
     WHERE e.group_id = ? AND e.activite_id = ? AND e.unite_id = ? AND e.type = 'recette'
       AND (e.category_id IS NULL OR e.category_id NOT IN (${EXCLUS}))`,
  ).get<{ total: number }>(ctx.groupId, camp.activite_id, camp.unite_id, ...CATEGORIES_HORS_RESULTAT);

  const rows = buildCampBudgetRows({
    budgetDepenses: budget.filter((b) => b.type === 'depense'),
    budgetRecettes: budget.filter((b) => b.type === 'recette'),
    ecrituresDepenses: ecrDep,
    depotsEnAttente: depAttente,
    recettesEncaissees: rec?.total ?? 0,
  });

  const ECR_SELECT = `
    SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type, e.justif_attendu,
           c.name AS category_name,
           EXISTS(SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id) AS has_justificatif,
           (SELECT r.id FROM remboursements r WHERE r.ecriture_id = e.id LIMIT 1) AS remboursement_id
    FROM ecritures e LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.group_id = ? AND e.activite_id = ? AND e.unite_id = ?`;

  // Onglet Dépenses : ne montrer que les dépenses ici. Les recettes ont
  // leur propre onglet (« Paiements reçus », cf. selectCampRecettes).
  const ecrituresRecentes = await db.prepare(
    `${ECR_SELECT} AND e.type = 'depense' ORDER BY e.date_ecriture DESC, e.id DESC LIMIT 20`,
  ).all<EcritureCampRow>(ctx.groupId, camp.activite_id, camp.unite_id);

  const justifsManquants = await db.prepare(
    `${ECR_SELECT} AND e.type = 'depense' AND e.justif_attendu = 1
       AND NOT EXISTS(SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id)
       AND NOT EXISTS(SELECT 1 FROM remboursements r WHERE r.ecriture_id = e.id)
     ORDER BY e.date_ecriture DESC LIMIT 50`,
  ).all<EcritureCampRow>(ctx.groupId, camp.activite_id, camp.unite_id);

  const recettes = await selectCampRecettes(db, ctx.groupId, camp.activite_id, camp.unite_id);

  const depotsEnAttente = await db.prepare(
    `SELECT d.id, d.titre, d.amount_cents, d.date_estimee, c.name AS category_name,
            u.nom_affichage AS submitter_name
     FROM depots_justificatifs d
     LEFT JOIN categories c ON c.id = d.category_id
     LEFT JOIN users u ON u.id = d.submitted_by_user_id
     WHERE d.group_id = ? AND d.activite_id = ? AND d.unite_id = ? AND d.statut = 'a_traiter'
     ORDER BY d.created_at DESC`,
  ).all<DepotCampRow>(ctx.groupId, camp.activite_id, camp.unite_id);

  // Garde-fou : une écriture de l'activité SANS branche/pôle (unite_id null)
  // n'apparaît dans AUCUN camp (camp = activité × unité) — on la signale
  // pour éviter les trous silencieux ; à imputer depuis /ecritures.
  const orphelines = await db.prepare(
    `SELECT COUNT(*) AS n FROM ecritures e
     WHERE e.group_id = ? AND e.activite_id = ? AND e.unite_id IS NULL`,
  ).get<{ n: number }>(ctx.groupId, camp.activite_id);

  return { camp, rows, ecrituresRecentes, depotsEnAttente, justifsManquants, recettes, sansUniteCount: orphelines?.n ?? 0 };
}
