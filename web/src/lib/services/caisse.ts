import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { nullIfEmpty } from '../utils/form';
import { uniteScopeSql } from '../scope';
import type {
  MouvementCaisse,
  MouvementCaisseStatus,
  MouvementCaisseType,
  DepotEspeces,
  Justificatif,
  EtatMouvementCaisse,
} from '../types';
import { createDepotEspeces, attachDepotEspecesToEcriture } from './depots-especes';
import { attachJustificatif } from './justificatifs';

export interface CaisseContext {
  groupId: string;
  // Si défini, restreint aux mouvements de CES unités (vue chef multi-unités).
  scopeUniteIds?: string[];
}

// État Comptaweb du mouvement (cf. ETATS_MOUVEMENT_CAISSE dans types.ts).
const ETAT_SQL = `CASE
  WHEN m.comptaweb_ecriture_id IS NOT NULL THEN 'mirror'
  WHEN m.status IN ('depose', 'rapproche') THEN 'pending'
  ELSE 'draft' END`;

export interface ListMouvementsCaisseOptions {
  limit?: number;
  offset?: number;
  unite_id?: string | null;
  activite_id?: string | null;
  category_id?: string | null;
  type?: MouvementCaisseType | null;
  date_debut?: string | null;
  date_fin?: string | null;
  month?: string | null;
  etats?: EtatMouvementCaisse[] | null;
  comptaweb_ecriture_id?: number | null;
  search?: string | null;
}

export async function listMouvementsCaisse(
  { groupId, scopeUniteIds }: CaisseContext,
  options: ListMouvementsCaisseOptions = {},
): Promise<{
  mouvements: Array<MouvementCaisse & { etat: EtatMouvementCaisse }>;
  solde: number;
  total: number;
}> {
  const db = getDb();
  const { limit = 50, offset = 0 } = options;

  const conditions: string[] = ['m.group_id = ?'];
  const values: unknown[] = [groupId];
  const scope = uniteScopeSql(scopeUniteIds ?? [], 'm.unite_id');
  if (scope.sql) {
    conditions.push(scope.sql);
    values.push(...scope.params);
  } else if (options.unite_id) {
    conditions.push('m.unite_id = ?');
    values.push(options.unite_id);
  }
  if (options.activite_id) {
    conditions.push('m.activite_id = ?');
    values.push(options.activite_id);
  }

  // Soft-delete : on exclut les lignes archivées de la liste et du
  // solde par défaut (cf. archiveOrphanedCaisseRows dans caisse-sync).
  conditions.push('m.archived_at IS NULL');
  // Le solde reste celui de la caisse (unité / activité / scope), sans les
  // filtres de recherche ci-dessous : une période ou un état ne change pas
  // l'argent en caisse.
  const soldeWhere = `WHERE ${conditions.join(' AND ')}`;
  const soldeValues = [...values];

  if (options.category_id) {
    conditions.push('m.category_id = ?');
    values.push(options.category_id);
  }
  if (options.type) {
    conditions.push('m.type = ?');
    values.push(options.type);
  }
  if (options.date_debut) {
    conditions.push('m.date_mouvement >= ?');
    values.push(options.date_debut);
  }
  if (options.date_fin) {
    conditions.push('m.date_mouvement <= ?');
    values.push(options.date_fin);
  }
  if (options.month) {
    conditions.push('m.date_mouvement LIKE ?');
    values.push(`${options.month}%`);
  }
  if (options.etats && options.etats.length > 0) {
    conditions.push(`(${ETAT_SQL}) IN (${options.etats.map(() => '?').join(', ')})`);
    values.push(...options.etats);
  }
  if (options.comptaweb_ecriture_id != null) {
    conditions.push('m.comptaweb_ecriture_id = ?');
    values.push(options.comptaweb_ecriture_id);
  }
  if (options.search) {
    const q = `%${options.search}%`;
    conditions.push('(m.description LIKE ? OR m.notes LIKE ? OR m.numero_piece LIKE ?)');
    values.push(q, q, q);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const mouvements = await db
    .prepare(
      `SELECT m.*, (${ETAT_SQL}) AS etat, u.code AS unite_code, a.name AS activite_name,
              c.name AS category_name
       FROM mouvements_caisse m
       LEFT JOIN unites u ON u.id = m.unite_id
       LEFT JOIN activites a ON a.id = m.activite_id
       LEFT JOIN categories c ON c.id = m.category_id
       ${where}
       ORDER BY m.date_mouvement DESC, m.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all<MouvementCaisse & { etat: EtatMouvementCaisse }>(...values, limit, offset);

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM mouvements_caisse m ${where}`)
    .get<{ n: number }>(...values);

  const soldeRow = await db
    .prepare(`SELECT COALESCE(SUM(m.amount_cents), 0) as total FROM mouvements_caisse m ${soldeWhere}`)
    .get<{ total: number }>(...soldeValues);

  return { mouvements, solde: soldeRow?.total ?? 0, total: totalRow?.n ?? 0 };
}

// ─── Modification d'un mouvement (#62) ──────────────────────────────────
//
// Enrichissement d'un mouvement existant : titre, catégorie, unité,
// activité, notes. Sur un mouvement miroir (présent dans Comptaweb), le
// titre et l'imputation sont tenus par Comptaweb — comme pour les écritures
// bancaires (cf. update_ecriture) : un changement de l'un d'eux est REFUSÉ,
// en nommant le champ, et rien n'est écrit. Les notes restent Baloo-only.

export const CHAMPS_COMPTAWEB_MOUVEMENT_CAISSE = [
  'description',
  'category_id',
  'unite_id',
  'activite_id',
] as const;

export class MouvementCaisseMiroirError extends Error {
  constructor(
    public readonly mouvementId: string,
    public readonly champs: string[],
  ) {
    super(
      `Refusé : le mouvement ${mouvementId} est un miroir Comptaweb ; ` +
        `Comptaweb fait foi pour ${champs.map((c) => `\`${c}\``).join(', ')}. ` +
        'Modifie-le dans Comptaweb, la sync caisse le reflétera. Rien n’a été changé.',
    );
    this.name = 'MouvementCaisseMiroirError';
  }
}

export interface UpdateMouvementCaisseInput {
  description?: string;
  category_id?: string | null;
  unite_id?: string | null;
  activite_id?: string | null;
  notes?: string | null;
}

async function getMouvementCaisseInScope(
  { groupId, scopeUniteIds }: CaisseContext,
  id: string,
): Promise<MouvementCaisse | null> {
  const scope = uniteScopeSql(scopeUniteIds ?? [], 'unite_id');
  const row = await getDb()
    .prepare(
      `SELECT * FROM mouvements_caisse
       WHERE id = ? AND group_id = ? AND archived_at IS NULL${scope.sql ? ` AND ${scope.sql}` : ''}`,
    )
    .get<MouvementCaisse>(id, groupId, ...scope.params);
  return row ?? null;
}

export async function updateMouvementCaisse(
  ctx: CaisseContext,
  id: string,
  input: UpdateMouvementCaisseInput,
): Promise<MouvementCaisse | null> {
  const existing = await getMouvementCaisseInScope(ctx, id);
  if (!existing) return null;

  const patch: Record<string, string | null> = {};
  if (input.description !== undefined) {
    const description = input.description.trim();
    if (!description) throw new Error('Le titre (description) ne peut pas être vide.');
    patch.description = description;
  }
  for (const k of ['category_id', 'unite_id', 'activite_id', 'notes'] as const) {
    if (input[k] !== undefined) patch[k] = nullIfEmpty(input[k]);
  }

  const scopeUniteIds = ctx.scopeUniteIds ?? [];
  if (patch.unite_id !== undefined && scopeUniteIds.length > 0 && !scopeUniteIds.includes(patch.unite_id ?? '')) {
    throw new Error('Choisis une unité parmi les tiennes.');
  }

  if (existing.comptaweb_ecriture_id != null) {
    const current = existing as unknown as Record<string, unknown>;
    const refuses = CHAMPS_COMPTAWEB_MOUVEMENT_CAISSE.filter(
      (k) => patch[k] !== undefined && patch[k] !== (current[k] ?? null),
    );
    if (refuses.length > 0) throw new MouvementCaisseMiroirError(id, refuses);
  }

  const keys = Object.keys(patch);
  if (keys.length > 0) {
    await getDb()
      .prepare(`UPDATE mouvements_caisse SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND group_id = ?`)
      .run(...keys.map((k) => patch[k]), id, ctx.groupId);
  }
  return getMouvementCaisseInScope(ctx, id);
}

// Pièce justificative d'un mouvement de caisse (#62) : même table et même
// stockage que celles des écritures (`justificatifs`, entity_type
// 'mouvement_caisse'). Permis aussi sur un miroir : la pièce est Baloo-only.
export async function attachJustificatifMouvementCaisse(
  ctx: CaisseContext,
  id: string,
  input: { filename: string; content: Buffer; mime_type?: string | null },
): Promise<Justificatif> {
  const mouvement = await getMouvementCaisseInScope(ctx, id);
  if (!mouvement) throw new Error(`Mouvement de caisse ${id} introuvable.`);
  return attachJustificatif(
    { groupId: ctx.groupId },
    { entity_type: 'mouvement_caisse', entity_id: id, ...input },
  );
}

export interface CreateMouvementCaisseInput {
  date_mouvement: string;
  description: string;
  amount_cents: number;
  // Optionnel : si non fourni, inféré du signe (positif=entree, negatif=sortie).
  // Sauf 'depot' qui doit être explicite (signal sortie vers banque).
  type?: MouvementCaisseType | null;
  numero_piece?: string | null;
  status?: MouvementCaisseStatus;
  depot_id?: string | null;
  airtable_id?: string | null;
  unite_id?: string | null;
  activite_id?: string | null;
  notes?: string | null;
}

export async function createMouvementCaisse(
  { groupId }: CaisseContext,
  input: CreateMouvementCaisseInput,
): Promise<MouvementCaisse> {
  const db = getDb();

  // Idempotence import : si airtable_id déjà connu, retourne l'existant.
  if (input.airtable_id) {
    const existing = await db
      .prepare('SELECT * FROM mouvements_caisse WHERE group_id = ? AND airtable_id = ?')
      .get<MouvementCaisse>(groupId, input.airtable_id);
    if (existing) return existing;
  }

  const id = await nextId('CAI');
  const now = currentTimestamp();

  const inferredType: MouvementCaisseType =
    input.type ?? (input.amount_cents >= 0 ? 'entree' : 'sortie');

  // Solde "global" du groupe — `solde_apres_cents` reste un running
  // total non scoped même en présence d'unite_id, pour rester cohérent
  // avec l'historique existant.
  const soldeBefore = await db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse WHERE group_id = ?')
    .get<{ total: number }>(groupId);
  const soldeAfter = (soldeBefore?.total ?? 0) + input.amount_cents;

  await db
    .prepare(
      `INSERT INTO mouvements_caisse
         (id, group_id, date_mouvement, description, amount_cents,
          type, numero_piece, status, depot_id, airtable_id,
          unite_id, activite_id, solde_apres_cents, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      groupId,
      input.date_mouvement,
      input.description,
      input.amount_cents,
      inferredType,
      nullIfEmpty(input.numero_piece),
      input.status ?? 'saisi',
      nullIfEmpty(input.depot_id),
      nullIfEmpty(input.airtable_id),
      nullIfEmpty(input.unite_id),
      nullIfEmpty(input.activite_id),
      soldeAfter,
      nullIfEmpty(input.notes),
      now,
    );

  return (await db.prepare('SELECT * FROM mouvements_caisse WHERE id = ?').get<MouvementCaisse>(id))!;
}

// Crée un dépôt espèces (entrée dans la table depots_especes) ET le
// mouvement caisse négatif lié (sortie d'argent de la caisse). Les
// deux sont marqués 'depose' (en attente du rapprochement banque).
//
// Pas de transaction explicite : libsql remote ne supporte pas les
// transactions multi-statement. Sécurité acceptée car même en cas
// d'échec partiel, on peut re-jouer l'opération (pas de doublon car
// pas d'airtable_id ici).
export interface CreateDepotEspecesAvecMouvementInput {
  date_depot: string;
  total_amount_cents: number;
  description?: string | null;
  detail_billets?: string | null;
  notes?: string | null;
  // Transfert interne (#51) : dépôt créé depuis le brouillon bancaire qui le
  // reflète. Le dépôt naît rapproché de cette écriture (même opération côté
  // caisse et côté banque).
  ecriture_id?: string | null;
}

// Écriture banque à laquelle rattacher un mouvement de caisse : vérifiée
// AVANT toute création, pour ne pas laisser un dépôt/retrait orphelin si l'id
// est faux.
async function requireEcriture(
  groupId: string,
  ecritureId: string,
): Promise<{ id: string; numero_piece: string | null }> {
  const ecriture = await getDb()
    .prepare('SELECT id, numero_piece FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ id: string; numero_piece: string | null }>(ecritureId, groupId);
  if (!ecriture) throw new Error(`Écriture ${ecritureId} introuvable dans ce groupe.`);
  return ecriture;
}

export async function createDepotEspecesAvecMouvement(
  { groupId }: CaisseContext,
  input: CreateDepotEspecesAvecMouvementInput,
): Promise<{ depot: DepotEspeces; mouvement: MouvementCaisse }> {
  if (input.total_amount_cents <= 0) {
    throw new Error('Le montant du dépôt doit être strictement positif.');
  }
  const ecritureId = nullIfEmpty(input.ecriture_id);
  if (ecritureId) await requireEcriture(groupId, ecritureId);

  const depot = await createDepotEspeces(
    { groupId },
    {
      date_depot: input.date_depot,
      total_amount_cents: input.total_amount_cents,
      detail_billets: input.detail_billets,
      notes: input.notes,
    },
  );

  const description = input.description?.trim() || `Dépôt en banque ${input.date_depot}`;

  const mouvement = await createMouvementCaisse(
    { groupId },
    {
      date_mouvement: input.date_depot,
      description,
      amount_cents: -Math.abs(input.total_amount_cents),
      type: 'depot',
      numero_piece: depot.id,
      status: 'depose',
      depot_id: depot.id,
      notes: input.notes,
    },
  );

  if (!ecritureId) return { depot, mouvement };

  // Même chemin que le rapprochement manuel : lie le dépôt et passe ses
  // mouvements en 'rapproche'.
  const lie = await attachDepotEspecesToEcriture({ groupId }, depot.id, ecritureId);
  const mouvementLie = await getDb()
    .prepare('SELECT * FROM mouvements_caisse WHERE id = ?')
    .get<MouvementCaisse>(mouvement.id);
  return { depot: lie, mouvement: mouvementLie ?? mouvement };
}

// ─── Retrait d'espèces (banque → caisse, #51) ─────────────────────────────
//
// Symétrique du dépôt : de l'argent retiré du compte et mis en caisse. Côté
// caisse, un mouvement POSITIF de type 'retrait' ; côté banque, le brouillon
// « Transfert interne — retrait d'espèces ». Pas de table dédiée : un retrait
// est un seul mouvement (pas de bordereau de billets à suivre comme un dépôt).
//
// Lien retrait ↔ écriture banque : le NUMÉRO DE PIÈCE partagé. Dans Comptaweb,
// un transfert interne est UNE écriture qui apparaît à la fois sur le compte et
// dans la caisse, avec un seul n° de pièce ; c'est aussi la clé de la sync
// caisse (`caisse-sync`, match numero_piece + date + montant). Au rattachement,
// le mouvement prend le n° de pièce de l'écriture (à défaut son id) et
// l'écriture prend ce même n° s'il lui manquait — il partira tel quel dans
// Comptaweb à la validation. Le mouvement passe en 'rapproche'.

export interface CreateRetraitEspecesAvecMouvementInput {
  date_retrait: string;
  total_amount_cents: number;
  description?: string | null;
  notes?: string | null;
  ecriture_id?: string | null;
}

export async function createRetraitEspecesAvecMouvement(
  { groupId }: CaisseContext,
  input: CreateRetraitEspecesAvecMouvementInput,
): Promise<{ mouvement: MouvementCaisse }> {
  if (input.total_amount_cents <= 0) {
    throw new Error('Le montant du retrait doit être strictement positif.');
  }
  const ecritureId = nullIfEmpty(input.ecriture_id);
  if (ecritureId) await requireEcriture(groupId, ecritureId);

  const mouvement = await createMouvementCaisse(
    { groupId },
    {
      date_mouvement: input.date_retrait,
      description: input.description?.trim() || `Retrait en banque ${input.date_retrait}`,
      amount_cents: Math.abs(input.total_amount_cents),
      type: 'retrait',
      status: 'saisi',
      notes: input.notes,
    },
  );
  if (!ecritureId) return { mouvement };
  return { mouvement: await attachRetraitEspecesToEcriture({ groupId }, mouvement.id, ecritureId) };
}

export async function attachRetraitEspecesToEcriture(
  { groupId }: CaisseContext,
  mouvementId: string,
  ecritureId: string,
): Promise<MouvementCaisse> {
  const db = getDb();
  const mouvement = await db
    .prepare("SELECT * FROM mouvements_caisse WHERE id = ? AND group_id = ? AND type = 'retrait'")
    .get<MouvementCaisse>(mouvementId, groupId);
  if (!mouvement) throw new Error(`Retrait d'espèces ${mouvementId} introuvable.`);
  const ecriture = await requireEcriture(groupId, ecritureId);

  // UPSERT : on ne remplace jamais un n° de pièce déjà posé (règle « JAMAIS
  // écraser une saisie »). Deux n° différents déjà saisis = deux opérations
  // distinctes, ou une saisie à corriger : on refuse plutôt que de lier à
  // moitié.
  if (mouvement.numero_piece && ecriture.numero_piece && mouvement.numero_piece !== ecriture.numero_piece) {
    throw new Error(
      `Le retrait ${mouvementId} (pièce ${mouvement.numero_piece}) et l'écriture ${ecritureId} ` +
        `(pièce ${ecriture.numero_piece}) n'ont pas le même n° de pièce.`,
    );
  }
  const piece = ecriture.numero_piece ?? mouvement.numero_piece ?? ecriture.id;
  await db
    .prepare(
      `UPDATE mouvements_caisse SET numero_piece = COALESCE(numero_piece, ?), status = 'rapproche'
       WHERE id = ? AND group_id = ?`,
    )
    .run(piece, mouvementId, groupId);
  await db
    .prepare('UPDATE ecritures SET numero_piece = COALESCE(numero_piece, ?) WHERE id = ? AND group_id = ?')
    .run(piece, ecritureId, groupId);

  return (await db.prepare('SELECT * FROM mouvements_caisse WHERE id = ?').get<MouvementCaisse>(mouvementId))!;
}

// Opération de caisse liée à une écriture banque (vue « brouillon » du
// transfert interne) : le dépôt qui la pointe, ou le retrait rapproché qui
// partage son n° de pièce. Null si rien n'est lié.
export type OperationCaisseLiee =
  | { kind: 'depot'; depot: DepotEspeces }
  | { kind: 'retrait'; mouvement: MouvementCaisse };

export async function getOperationCaisseLiee(
  { groupId }: CaisseContext,
  ecritureId: string,
): Promise<OperationCaisseLiee | null> {
  const db = getDb();
  const depot = await db
    .prepare('SELECT * FROM depots_especes WHERE group_id = ? AND ecriture_id = ? AND archived_at IS NULL LIMIT 1')
    .get<DepotEspeces>(groupId, ecritureId);
  if (depot) return { kind: 'depot', depot };
  const retrait = await db
    .prepare(
      `SELECT m.* FROM mouvements_caisse m
       JOIN ecritures e ON e.id = ? AND e.group_id = m.group_id
       WHERE m.group_id = ? AND m.type = 'retrait' AND m.status = 'rapproche'
         AND m.archived_at IS NULL AND m.numero_piece = e.numero_piece
       LIMIT 1`,
    )
    .get<MouvementCaisse>(ecritureId, groupId);
  return retrait ? { kind: 'retrait', mouvement: retrait } : null;
}

// Retraits pas encore rapprochés d'une écriture banque (candidats au lien
// depuis un brouillon « retrait d'espèces »).
export async function listRetraitsEspecesEnAttente(
  { groupId }: CaisseContext,
  options: { limit?: number } = {},
): Promise<MouvementCaisse[]> {
  return await getDb()
    .prepare(
      `SELECT * FROM mouvements_caisse
       WHERE group_id = ? AND type = 'retrait' AND status <> 'rapproche' AND archived_at IS NULL
       ORDER BY date_mouvement DESC, created_at DESC
       LIMIT ?`,
    )
    .all<MouvementCaisse>(groupId, options.limit ?? 50);
}
