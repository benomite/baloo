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

// Code carte procurement visible dans les intitulés "PAIEMENT C. PROC XXXX".
// Les CB classiques n'ont pas d'identifiant dans l'intitulé bancaire, d'où
// pas de regex pour elles ici (sélection manuelle dans le form).
function extractCarteProcCode(intitule: string): string | null {
  const m = intitule.toUpperCase().match(/PAIEMENT C\. PROC\s+([A-Z0-9]{6,})/);
  return m ? m[1] : null;
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
    const findCarte = db.prepare(
      "SELECT id FROM cartes WHERE group_id = ? AND code_externe = ? AND statut = 'active' LIMIT 1",
    );
    const insert = db.prepare(
      `INSERT INTO ecritures (
         id, group_id, unite_id, date_ecriture, description, amount_cents, type,
         category_id, mode_paiement_id, activite_id, numero_piece, status,
         comptaweb_synced, ligne_bancaire_id, ligne_bancaire_sous_index,
         comptaweb_ecriture_id, carte_id, notes, created_at, updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'brouillon', 0, ?, ?, NULL, ?, ?, ?, ?)`,
    );

    let crees = 0;
    let existants = 0;
    for (const c of candidates) {
      const existing = await findExisting.get(groupId, c.ligneBancaireId, c.sousLigneIndex, c.sousLigneIndex);
      if (existing) { existants++; continue; }
      const type = c.montantCentimes < 0 ? 'depense' : 'recette';
      const amountAbs = Math.abs(c.montantCentimes);
      const cwMode = inferComptawebModeId(c.intituleParent);
      const modeLocal = cwMode !== null
        ? (await findMode.get<{ id: string }>(cwMode))?.id ?? null
        : null;
      const carteCode = extractCarteProcCode(c.intituleParent);
      const carteLocal = carteCode
        ? (await findCarte.get<{ id: string }>(groupId, carteCode))?.id ?? null
        : null;
      const id = await nextId('ECR');
      const now = currentTimestamp();
      const notes = c.sousLigneIndex !== null
        ? `Draft généré depuis ligne bancaire ${c.ligneBancaireId} sous-ligne ${c.sousLigneIndex} (intitulé parent: ${c.intituleParent.slice(0, 80)}).`
        : `Draft généré depuis ligne bancaire ${c.ligneBancaireId}.`;
      await insert.run(id, groupId, c.dateOperation, c.libelProposal, amountAbs, type, modeLocal, c.ligneBancaireId, c.sousLigneIndex, carteLocal, notes, now, now);
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

// tierscateg=10 = 'Autre : pas structure SGDF' : cas nominal pour toute
// écriture Baloo (dépense chez un fournisseur, recette d'une famille, frais
// bancaires...). 'Mon groupe' (4) est réservé aux mouvements internes purs —
// à gérer explicitement quand on en aura besoin.
const DEFAULT_TIERS_CATEG_ID = '10';
const DEFAULT_TIERS_STRUCTURE_ID = ''; // vide quand catég = 'Autre'
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
  justif_attendu: number;
  carte_id: string | null;
}

interface CarteRow {
  id: string;
  type: 'cb' | 'procurement';
  comptaweb_id: number | null;
}

function isoToFr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Date ISO invalide : ${iso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

async function lookupComptawebId(table: string, id: string | null): Promise<number | null> {
  if (!id) return null;
  const row = await getDb().prepare(`SELECT comptaweb_id FROM ${table} WHERE id = ?`).get<{ comptaweb_id: number | null }>(id);
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
    const ecr = await db.prepare(
      `SELECT id, group_id, date_ecriture, description, amount_cents, type,
              unite_id, category_id, activite_id, mode_paiement_id, numero_piece, status, justif_attendu, carte_id
       FROM ecritures WHERE id = ? AND group_id = ?`,
    ).get<DraftRow>(ecritureId, groupId);
    if (!ecr) return { ok: false, message: `Écriture ${ecritureId} introuvable.`, dryRun: opts.dryRun !== false };

    const natureCw = await lookupComptawebId('categories', ecr.category_id);
    const activiteCw = await lookupComptawebId('activites', ecr.activite_id);
    const uniteCw = await lookupComptawebId('unites', ecr.unite_id);
    const modeCw = await lookupComptawebId('modes_paiement', ecr.mode_paiement_id);
    const justRow = await db.prepare("SELECT COUNT(*) as n FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = ?").get<{ n: number }>(ecr.id);
    const hasJust = (justRow?.n ?? 0) > 0;

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
    // Le justif physique n'est plus requis pour sync : Comptaweb ne gère pas
    // les fichiers, seul un code suffit. Si on n'a rien, on retombe sur l'ID
    // de l'écriture (stable, unique, permet de rattacher le justif plus tard).

    const dryRun = opts.dryRun !== false;
    if (missing.length && !dryRun) {
      return { ok: false, message: `Validation : ${missing.join(', ')}.`, dryRun: false, missingFields: missing };
    }

    let numeropiece = ecr.numero_piece ?? '';
    if (!numeropiece) {
      if (hasJust) {
        const j = await db.prepare("SELECT id FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = ? ORDER BY uploaded_at LIMIT 1").get<{ id: string }>(ecr.id);
        if (j) numeropiece = j.id;
      }
      if (!numeropiece) numeropiece = ecr.id;
    }

    // Carte associée : selon son type, on envoie vers cartebancaire ou
    // carteprocurement.
    const carte = ecr.carte_id
      ? await db.prepare('SELECT id, type, comptaweb_id FROM cartes WHERE id = ?').get<CarteRow>(ecr.carte_id)
      : undefined;
    const cartebancaireId = carte?.type === 'cb' && carte.comptaweb_id ? String(carte.comptaweb_id) : undefined;
    const carteprocurementId = carte?.type === 'procurement' && carte.comptaweb_id ? String(carte.comptaweb_id) : undefined;

    const input: CreateEcritureInput = {
      type: ecr.type,
      libel: ecr.description,
      dateecriture: isoToFr(ecr.date_ecriture),
      montant: (ecr.amount_cents / 100).toFixed(2).replace('.', ','),
      numeropiece: numeropiece || undefined,
      modetransactionId: modeCw !== null ? String(modeCw) : '',
      comptebancaireId: DEFAULT_COMPTE_BANCAIRE_ID,
      cartebancaireId,
      carteprocurementId,
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
    // On persiste le numero_piece utilisé (y compris le fallback auto) pour
    // rester cohérent avec ce qu'on a envoyé côté Comptaweb.
    await db.prepare(
      `UPDATE ecritures SET status = 'saisie_comptaweb', comptaweb_synced = 1,
       comptaweb_ecriture_id = ?, numero_piece = ?, updated_at = ? WHERE id = ?`,
    ).run(result.ecritureId ?? null, numeropiece, currentTimestamp(), ecr.id);
    return { ok: true, message: `Synchronisé vers Comptaweb (id ${result.ecritureId}).`, dryRun: false, ecritureId: result.ecritureId };
  } catch (err) {
    if (err instanceof ComptawebSessionExpiredError) return { ok: false, message: 'Session Comptaweb expirée.', dryRun: opts.dryRun !== false };
    return { ok: false, message: err instanceof Error ? err.message : String(err), dryRun: opts.dryRun !== false };
  }
}
