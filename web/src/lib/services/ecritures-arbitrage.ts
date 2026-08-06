// Arbitrage utilisateur des sorties de la réconciliation (spec 2026-06-01) :
//   - écritures `supprimee_cw` : restaurer en draft, ou supprimer pour de bon
//     (uniquement si aucune pièce attachée — garde-fou canHardDelete).
//   - suggestions de lien draft↔CW : confirmer (promotion) ou rejeter.
//
// Toute la logique BDD vit ici (db injectable, testable). Les server actions
// (`lib/actions/ecritures-arbitrage.ts`) ne font que router le contexte +
// revalidatePath.

import type { DbWrapper } from '../db';
import { getDb } from '../db';
import { currentTimestamp } from '../ids';
import { logError } from '../log';
import { canHardDelete, type EcritureStatus } from './ecritures-sync-transitions';
import { getSuggestion, resolveSuggestion } from './cw-link-suggestions';

export type ArbitrageReason = 'not_found' | 'wrong_status' | 'has_attachments' | 'not_pending';
export interface ArbitrageResult {
  ok: boolean;
  reason?: ArbitrageReason;
}

async function tableExists(db: DbWrapper, name: string): Promise<boolean> {
  const r = await db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get<{ x: number }>(name);
  return !!r;
}

// Tables de DONNÉES UTILISATEUR qui pointent vers une écriture (ecriture_id).
// Si l'une référence l'écriture, la suppression est refusée (pas un simple
// doublon). Toutes sont lazy-init sauf en prod où elles existent : on garde
// par `tableExists` pour ne pas planter sur une base où elles n'existent pas.
//
// `label` = expression SQL du libellé montré à l'utilisateur, `prefix` = texte
// qui la précède. Le libellé est facultatif : si la colonne manque (base plus
// ancienne), on retombe sur l'id seul plutôt que de planter la page — cf.
// AGENTS.md « résoudre chaque champ indépendamment ».
const ATTACHMENT_TABLES = [
  { table: 'depots_justificatifs', kind: 'depot', label: 'titre', prefix: 'Dépôt de justif' },
  { table: 'depots_especes', kind: 'depot_especes', label: 'date_depot', prefix: 'Dépôt d’espèces du' },
  { table: 'remboursements', kind: 'remboursement', label: 'demandeur', prefix: 'Remboursement' },
  { table: 'avances_camp', kind: 'avance_camp', label: 'beneficiaire', prefix: 'Avance de camp' },
] as const;

export type AttachmentKind = 'justificatif' | (typeof ATTACHMENT_TABLES)[number]['kind'];

/** Une pièce qui référence l'écriture, telle qu'elle existe en base. */
export interface Attachment {
  kind: AttachmentKind;
  id: string;
  label: string;
  /**
   * Pour un justificatif : le dépôt d'où vient le fichier, déduit du préfixe de
   * `file_path` (`depot/<id>/…`, figé à la création et jamais déplacé). Permet
   * à l'UI de regrouper les fichiers sous le dépôt, seul objet détachable.
   */
  from_depot_id: string | null;
}

/** Extrait l'id du dépôt d'origine d'un chemin de blob (`depot/DEP-1/x.jpg`). */
function depotIdFromPath(filePath: string | null): string | null {
  const m = /^depot\/([^/]+)\//.exec(filePath ?? '');
  return m ? m[1] : null;
}

/**
 * Pièces attachées à PLUSIEURS écritures, en une passe : une requête par table
 * quel que soit le nombre d'écritures (la bannière d'arbitrage peut en lister
 * des dizaines, et chaque aller-retour libsql remote coûte).
 */
export async function listAttachmentsFor(
  db: DbWrapper,
  ecritureIds: string[],
): Promise<Map<string, Attachment[]>> {
  const byEcriture = new Map<string, Attachment[]>();
  for (const id of ecritureIds) byEcriture.set(id, []);
  if (ecritureIds.length === 0) return byEcriture;

  const holes = ecritureIds.map(() => '?').join(',');
  const push = (ecritureId: string, a: Attachment) => {
    // Une pièce d'une écriture hors périmètre ne doit pas créer d'entrée.
    byEcriture.get(ecritureId)?.push(a);
  };

  type JustifRow = {
    id: string;
    entity_id: string;
    original_filename: string | null;
    file_path: string | null;
  };
  let justifs: JustifRow[];
  try {
    justifs = await db
      .prepare(
        `SELECT id, entity_id, original_filename, file_path FROM justificatifs
         WHERE entity_type = 'ecriture' AND entity_id IN (${holes})`,
      )
      .all<JustifRow>(...ecritureIds);
  } catch {
    // Colonnes de libellé absentes : le garde-fou de suppression ne doit JAMAIS
    // tomber pour un libellé — on garde le décompte, qui seul protège les données.
    justifs = await db
      .prepare(
        `SELECT id, entity_id FROM justificatifs
         WHERE entity_type = 'ecriture' AND entity_id IN (${holes})`,
      )
      .all<JustifRow>(...ecritureIds);
  }
  for (const j of justifs) {
    push(j.entity_id, {
      kind: 'justificatif',
      id: j.id,
      label: j.original_filename || j.id,
      from_depot_id: depotIdFromPath(j.file_path),
    });
  }

  for (const { table, kind, label, prefix } of ATTACHMENT_TABLES) {
    if (!(await tableExists(db, table))) continue;
    type Row = { id: string; ecriture_id: string; label: string | null };
    let rows: Row[];
    try {
      rows = await db
        .prepare(
          `SELECT id, ecriture_id, ${label} AS label FROM ${table} WHERE ecriture_id IN (${holes})`,
        )
        .all<Row>(...ecritureIds);
    } catch {
      // Colonne de libellé absente : on garde la pièce (elle bloque quand même),
      // sans son libellé.
      rows = await db
        .prepare(`SELECT id, ecriture_id FROM ${table} WHERE ecriture_id IN (${holes})`)
        .all<Row>(...ecritureIds);
    }
    for (const r of rows) {
      push(r.ecriture_id, {
        kind,
        id: r.id,
        label: r.label ? `${prefix} ${r.label}` : `${prefix} ${r.id}`,
        from_depot_id: null,
      });
    }
  }

  return byEcriture;
}

/**
 * Liste nommée des pièces attachées à une écriture. Sert à la fois au garde-fou
 * de suppression (le compte) et à l'UI d'arbitrage (les libellés).
 */
export async function listAttachments(db: DbWrapper, ecritureId: string): Promise<Attachment[]> {
  return (await listAttachmentsFor(db, [ecritureId])).get(ecritureId) ?? [];
}

async function countAttachments(db: DbWrapper, ecritureId: string): Promise<number> {
  return (await listAttachments(db, ecritureId)).length;
}

/** Pièce bloquante telle qu'affichée dans la bannière d'arbitrage. */
export interface Blocker {
  kind: AttachmentKind;
  id: string;
  label: string;
  /** Un chemin utilisateur existe pour l'enlever (aujourd'hui : le dépôt de justif). */
  detachable: boolean;
  /** Nombre de fichiers regroupés sous ce bloqueur (dépôt). */
  file_count: number;
}

/**
 * Regroupe les pièces pour l'affichage : les fichiers issus d'un dépôt présent
 * dans la liste disparaissent au profit du dépôt (les détacher, c'est détacher
 * le dépôt). Fonction PURE — testable sans BDD.
 */
export function describeBlockers(attachments: Attachment[]): Blocker[] {
  const depotIds = new Set(attachments.filter((a) => a.kind === 'depot').map((a) => a.id));
  const out: Blocker[] = [];
  for (const a of attachments) {
    if (a.kind === 'justificatif' && a.from_depot_id && depotIds.has(a.from_depot_id)) continue;
    if (a.kind === 'depot') {
      const files = attachments.filter(
        (f) => f.kind === 'justificatif' && f.from_depot_id === a.id,
      ).length;
      out.push({
        kind: a.kind,
        id: a.id,
        label: files > 0 ? `${a.label} (${files} fichier${files > 1 ? 's' : ''})` : a.label,
        detachable: true,
        file_count: files,
      });
      continue;
    }
    out.push({ kind: a.kind, id: a.id, label: a.label, detachable: false, file_count: 0 });
  }
  return out;
}

// Retire les références NON-données-utilisateur qui bloqueraient le DELETE par
// FK : les marqueurs « Ignorer » (inbox_suggestion_rejets, FK NOT NULL vers
// ecritures). Une fois l'écriture supprimée, ce marqueur n'a plus de sens.
async function clearDeleteBlockers(db: DbWrapper, groupId: string, ecritureId: string): Promise<void> {
  if (await tableExists(db, 'inbox_suggestion_rejets')) {
    await db
      .prepare('DELETE FROM inbox_suggestion_rejets WHERE ecriture_id = ? AND group_id = ?')
      .run(ecritureId, groupId);
  }
}

/** Restaure une écriture `supprimee_cw` en brouillon local. */
export async function restoreSupprimeeToDraft(
  groupId: string,
  id: string,
  db: DbWrapper = getDb(),
): Promise<ArbitrageResult> {
  const cur = await db
    .prepare('SELECT status FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ status: EcritureStatus }>(id, groupId);
  if (!cur) return { ok: false, reason: 'not_found' };
  if (cur.status !== 'supprimee_cw' && cur.status !== 'agrege_remplace') {
    return { ok: false, reason: 'wrong_status' };
  }
  await db
    .prepare(`UPDATE ecritures SET status = 'draft', comptaweb_ecriture_id = NULL, updated_at = ? WHERE id = ? AND group_id = ?`)
    .run(currentTimestamp(), id, groupId);
  return { ok: true };
}

/**
 * Supprime définitivement une écriture `supprimee_cw` — seulement si aucune
 * pièce n'est attachée (garde-fou canHardDelete + CLAUDE.md « JAMAIS de
 * DELETE » sauf draft/supprimee_cw vide).
 */
export async function deleteArbitratedEcriture(
  groupId: string,
  id: string,
  db: DbWrapper = getDb(),
): Promise<ArbitrageResult> {
  const cur = await db
    .prepare('SELECT status FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ status: EcritureStatus }>(id, groupId);
  if (!cur) return { ok: false, reason: 'not_found' };
  if (cur.status !== 'supprimee_cw' && cur.status !== 'agrege_remplace') {
    return { ok: false, reason: 'wrong_status' };
  }
  const attachments = await countAttachments(db, id);
  if (!canHardDelete(cur.status, attachments > 0)) {
    return { ok: false, reason: 'has_attachments' };
  }
  // Nettoie les marqueurs « Ignorer » (FK NOT NULL) qui feraient échouer le
  // DELETE par contrainte — c'était la cause des crashs « sur certaines ».
  await clearDeleteBlockers(db, groupId, id);
  try {
    await db
      .prepare(
        `DELETE FROM ecritures WHERE id = ? AND group_id = ? AND status IN ('supprimee_cw','agrege_remplace')`,
      )
      .run(id, groupId);
  } catch (err) {
    // Filet de sécurité : une FK inattendue ne doit jamais planter la page.
    // On signale « pièce attachée » (message clair) plutôt qu'une 500.
    logError('ecritures-arbitrage', 'deleteArbitratedEcriture FK', err, { groupId, id });
    return { ok: false, reason: 'has_attachments' };
  }
  return { ok: true };
}

export interface BatchDeleteResult {
  ok: true;
  deleted: number;
  skipped: number;
}

/**
 * Supprime en lot toutes les écritures d'un statut arbitrable
 * (`agrege_remplace` ou `supprimee_cw`) du groupe. Chaque écriture passe par
 * le même garde-fou que la suppression unitaire : celles qui portent une pièce
 * (justif/dépôt/remb/avance) sont IGNORÉES, pas supprimées. Renvoie le décompte.
 */
export async function deleteAllArbitrated(
  groupId: string,
  status: 'agrege_remplace' | 'supprimee_cw',
  db: DbWrapper = getDb(),
): Promise<BatchDeleteResult> {
  const rows = await db
    .prepare('SELECT id FROM ecritures WHERE group_id = ? AND status = ?')
    .all<{ id: string }>(groupId, status);
  let deleted = 0;
  let skipped = 0;
  for (const r of rows) {
    const res = await deleteArbitratedEcriture(groupId, r.id, db);
    if (res.ok) deleted++;
    else skipped++;
  }
  return { ok: true, deleted, skipped };
}

/**
 * Confirme une suggestion de lien : pose la clé stable
 * (comptaweb_ecriture_id) sur le draft + copie les infos CW connues, passe
 * en `mirror`. `cw_signature = NULL` force la prochaine sync à relire le
 * détail (activité/branche) et à réaligner finement. Marque la suggestion
 * `confirme` et rejette les autres suggestions ouvertes du même draft.
 */
export async function confirmLink(
  groupId: string,
  suggestionId: string,
  db: DbWrapper = getDb(),
): Promise<ArbitrageResult> {
  const sugg = await getSuggestion(db, suggestionId);
  if (!sugg || sugg.group_id !== groupId) return { ok: false, reason: 'not_found' };
  if (sugg.status !== 'a_confirmer') return { ok: false, reason: 'not_pending' };

  const ecr = await db
    .prepare('SELECT status FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ status: EcritureStatus }>(sugg.ecriture_id, groupId);
  if (!ecr) return { ok: false, reason: 'not_found' };

  const now = currentTimestamp();
  await db
    .prepare(
      `UPDATE ecritures SET
         comptaweb_ecriture_id = ?, cw_numero_piece = ?,
         amount_cents = COALESCE(?, amount_cents),
         date_ecriture = COALESCE(?, date_ecriture),
         description = COALESCE(?, description),
         cw_signature = NULL, status = 'mirror', comptaweb_synced = 1, updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(
      sugg.cw_ecriture_id,
      sugg.cw_numero_piece,
      sugg.cw_montant_cents,
      sugg.cw_date,
      sugg.cw_intitule,
      now,
      sugg.ecriture_id,
      groupId,
    );

  await resolveSuggestion(db, suggestionId, 'confirme');
  // Les autres suggestions ouvertes du même draft n'ont plus lieu d'être.
  await db
    .prepare(
      `UPDATE cw_link_suggestions SET status = 'rejete', resolved_at = ?
       WHERE group_id = ? AND ecriture_id = ? AND status = 'a_confirmer'`,
    )
    .run(now, groupId, sugg.ecriture_id);

  return { ok: true };
}

/** Rejette une suggestion de lien (la ligne CW sera importée distinctement). */
export async function rejectLink(
  groupId: string,
  suggestionId: string,
  db: DbWrapper = getDb(),
): Promise<ArbitrageResult> {
  const sugg = await getSuggestion(db, suggestionId);
  if (!sugg || sugg.group_id !== groupId) return { ok: false, reason: 'not_found' };
  if (sugg.status !== 'a_confirmer') return { ok: false, reason: 'not_pending' };
  await resolveSuggestion(db, suggestionId, 'rejete');
  return { ok: true };
}
