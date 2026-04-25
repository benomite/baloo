import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { ensureComptawebEnv } from '../comptaweb/env-loader';
import {
  withAutoReLogin,
  listRapprochementBancaire,
  createEcriture,
  ComptawebSessionExpiredError,
} from '../comptaweb';
import type {
  EcritureBancaireNonRapprochee,
  SousLigneDsp2,
  CreateEcritureInput,
} from '../comptaweb';

ensureComptawebEnv();

export interface DraftsContext {
  groupId: string;
}

interface Candidate {
  ligneBancaireId: number;
  sousLigneIndex: number | null;
  dateOperation: string;
  montantCentimes: number;
  intituleParent: string;
  libelProposal: string;
}

function cleanLabel(label: string): string {
  return label.replace(/\s+\d{6,}\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function inferComptawebModeId(intitule: string): number | null {
  const s = intitule.toUpperCase();
  if (s.startsWith('VIR ') || s.includes(' VIR ') || s.includes('VIREMENT') || s.includes('VIR DE ')) return 1;
  if (s.includes('PAIEMENT C. PROC') || s.includes('CARTE PROCUREMENT')) return 9;
  if (s.includes('PAIEMENT PAR CB') || s.includes('CARTE BANCAIRE')) return 3;
  return null;
}

function listCandidates(lignes: EcritureBancaireNonRapprochee[]): Candidate[] {
  const out: Candidate[] = [];
  for (const l of lignes) {
    if (l.sousLignes.length > 0) {
      l.sousLignes.forEach((sl: SousLigneDsp2, idx: number) => {
        out.push({
          ligneBancaireId: l.id,
          sousLigneIndex: idx,
          dateOperation: l.dateOperation,
          montantCentimes: sl.montantCentimes,
          intituleParent: l.intitule,
          libelProposal: cleanLabel(sl.commercant),
        });
      });
    } else {
      out.push({
        ligneBancaireId: l.id,
        sousLigneIndex: null,
        dateOperation: l.dateOperation,
        montantCentimes: l.montantCentimes,
        intituleParent: l.intitule,
        libelProposal: cleanLabel(l.intitule),
      });
    }
  }
  return out;
}

export interface ScanDraftsResult {
  crees: number;
  existants: number;
  erreur?: string;
}

export async function scanDraftsFromComptaweb({ groupId }: DraftsContext): Promise<ScanDraftsResult> {
  try {
    const data = await withAutoReLogin((cfg) => listRapprochementBancaire(cfg));
    const db = getDb();
    const candidates = listCandidates(data.ecrituresBancaires);

    const findExisting = db.prepare(
      `SELECT id FROM ecritures
       WHERE group_id = ? AND ligne_bancaire_id = ?
         AND (ligne_bancaire_sous_index IS ? OR ligne_bancaire_sous_index = ?)
       LIMIT 1`,
    );
    const findMode = db.prepare('SELECT id FROM modes_paiement WHERE comptaweb_id = ? LIMIT 1');
    const insert = db.prepare(
      `INSERT INTO ecritures (
         id, group_id, unite_id, date_ecriture, description, amount_cents, type,
         category_id, mode_paiement_id, activite_id, numero_piece, status,
         comptaweb_synced, ligne_bancaire_id, ligne_bancaire_sous_index,
         comptaweb_ecriture_id, notes, created_at, updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'brouillon', 0, ?, ?, NULL, ?, ?, ?)`,
    );

    let crees = 0;
    let existants = 0;
    for (const c of candidates) {
      const existing = findExisting.get(groupId, c.ligneBancaireId, c.sousLigneIndex, c.sousLigneIndex);
      if (existing) { existants++; continue; }
      const type = c.montantCentimes < 0 ? 'depense' : 'recette';
      const amountAbs = Math.abs(c.montantCentimes);
      const cwMode = inferComptawebModeId(c.intituleParent);
      const modeLocal = cwMode !== null
        ? (findMode.get(cwMode) as { id: string } | undefined)?.id ?? null
        : null;
      const id = nextId('ECR');
      const now = currentTimestamp();
      const notes = c.sousLigneIndex !== null
        ? `Draft généré depuis ligne bancaire ${c.ligneBancaireId} sous-ligne ${c.sousLigneIndex} (intitulé parent: ${c.intituleParent.slice(0, 80)}).`
        : `Draft généré depuis ligne bancaire ${c.ligneBancaireId}.`;
      insert.run(id, groupId, c.dateOperation, c.libelProposal, amountAbs, type, modeLocal, c.ligneBancaireId, c.sousLigneIndex, notes, now, now);
      crees++;
    }

    return { crees, existants };
  } catch (err) {
    if (err instanceof ComptawebSessionExpiredError) {
      return { crees: 0, existants: 0, erreur: 'Session Comptaweb expirée.' };
    }
    return { crees: 0, existants: 0, erreur: err instanceof Error ? err.message : String(err) };
  }
}

const DEFAULT_TIERS_CATEG_ID = '4';
const DEFAULT_TIERS_STRUCTURE_ID = '498';
const DEFAULT_COMPTE_BANCAIRE_ID = '791';

interface DraftRow {
  id: string;
  group_id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  unite_id: string | null;
  category_id: string | null;
  activite_id: string | null;
  mode_paiement_id: string | null;
  numero_piece: string | null;
  status: string;
}

function isoToFr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Date ISO invalide : ${iso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function lookupComptawebId(table: string, id: string | null): number | null {
  if (!id) return null;
  const row = getDb().prepare(`SELECT comptaweb_id FROM ${table} WHERE id = ?`).get(id) as { comptaweb_id: number | null } | undefined;
  return row?.comptaweb_id ?? null;
}

export interface SyncDraftResult {
  ok: boolean;
  message: string;
  dryRun: boolean;
  ecritureId?: number;
  missingFields?: string[];
}

export async function syncDraftToComptaweb(
  { groupId }: DraftsContext,
  ecritureId: string,
  opts: { dryRun?: boolean } = {},
): Promise<SyncDraftResult> {
  try {
    const db = getDb();
    const ecr = db.prepare(
      `SELECT id, group_id, date_ecriture, description, amount_cents, type,
              unite_id, category_id, activite_id, mode_paiement_id, numero_piece, status
       FROM ecritures WHERE id = ? AND group_id = ?`,
    ).get(ecritureId, groupId) as DraftRow | undefined;
    if (!ecr) return { ok: false, message: `Écriture ${ecritureId} introuvable.`, dryRun: opts.dryRun !== false };

    const natureCw = lookupComptawebId('categories', ecr.category_id);
    const activiteCw = lookupComptawebId('activites', ecr.activite_id);
    const uniteCw = lookupComptawebId('unites', ecr.unite_id);
    const modeCw = lookupComptawebId('modes_paiement', ecr.mode_paiement_id);
    const hasJust = (db.prepare("SELECT COUNT(*) as n FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = ?").get(ecr.id) as { n: number }).n > 0;

    const missing: string[] = [];
    if (ecr.status !== 'brouillon') missing.push(`status '${ecr.status}' (seul 'brouillon' est synchronisable)`);
    if (!ecr.category_id) missing.push('nature');
    else if (natureCw === null) missing.push('mapping nature');
    if (!ecr.activite_id) missing.push('activité');
    else if (activiteCw === null) missing.push('mapping activité');
    if (!ecr.unite_id) missing.push('unité');
    else if (uniteCw === null) missing.push('mapping unité');
    if (!ecr.mode_paiement_id) missing.push('mode');
    else if (modeCw === null) missing.push('mapping mode');
    if (ecr.type === 'depense' && !hasJust && !ecr.numero_piece) missing.push('justif');

    const dryRun = opts.dryRun !== false;
    if (missing.length && !dryRun) {
      return { ok: false, message: `Validation : ${missing.join(', ')}.`, dryRun: false, missingFields: missing };
    }

    let numeropiece = ecr.numero_piece ?? '';
    if (!numeropiece && hasJust) {
      const j = db.prepare("SELECT id FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = ? ORDER BY uploaded_at LIMIT 1").get(ecr.id) as { id: string } | undefined;
      if (j) numeropiece = j.id;
    }

    const input: CreateEcritureInput = {
      type: ecr.type,
      libel: ecr.description,
      dateecriture: isoToFr(ecr.date_ecriture),
      montant: (ecr.amount_cents / 100).toFixed(2).replace('.', ','),
      numeropiece: numeropiece || undefined,
      modetransactionId: modeCw !== null ? String(modeCw) : '',
      comptebancaireId: DEFAULT_COMPTE_BANCAIRE_ID,
      tiersCategId: DEFAULT_TIERS_CATEG_ID,
      tiersStructureId: DEFAULT_TIERS_STRUCTURE_ID,
      ventilations: [{
        montant: (ecr.amount_cents / 100).toFixed(2).replace('.', ','),
        natureId: natureCw !== null ? String(natureCw) : '',
        activiteId: activiteCw !== null ? String(activiteCw) : '',
        brancheprojetId: uniteCw !== null ? String(uniteCw) : '',
      }],
    };

    const result = await withAutoReLogin((cfg) => createEcriture(cfg, input, { dryRun }));
    if (result.dryRun) {
      return { ok: missing.length === 0, message: missing.length ? `Preview : il manque ${missing.join(', ')}.` : 'Preview OK, prêt à synchroniser.', dryRun: true, missingFields: missing };
    }
    db.prepare(
      `UPDATE ecritures SET status = 'saisie_comptaweb', comptaweb_synced = 1,
       comptaweb_ecriture_id = ?, updated_at = ? WHERE id = ?`,
    ).run(result.ecritureId ?? null, currentTimestamp(), ecr.id);
    return { ok: true, message: `Synchronisé vers Comptaweb (id ${result.ecritureId}).`, dryRun: false, ecritureId: result.ecritureId };
  } catch (err) {
    if (err instanceof ComptawebSessionExpiredError) return { ok: false, message: 'Session Comptaweb expirée.', dryRun: opts.dryRun !== false };
    return { ok: false, message: err instanceof Error ? err.message : String(err), dryRun: opts.dryRun !== false };
  }
}
