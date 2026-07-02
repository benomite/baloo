import { getDb, type DbWrapper } from '../db';
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
import { planStaleLineDrafts, type ExistingLineDraft } from './drafts-line-reconcile';

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

// Candidats d'UNE ligne bancaire : un par sous-ligne DSP2 si présentes
// (grain réel de la dépense), sinon un seul pour la ligne entière. Ces deux
// formes sont MUTUELLEMENT EXCLUSIVES — cf. `drafts-line-reconcile.ts` pour la
// réconciliation quand la ventilation DSP2 d'une ligne change entre scrapes.
function candidatesForLine(l: EcritureBancaireNonRapprochee): Candidate[] {
  if (l.sousLignes.length > 0) {
    return l.sousLignes.map((sl: SousLigneDsp2, idx: number) => ({
      ligneBancaireId: l.id,
      sousLigneIndex: idx,
      dateOperation: l.dateOperation,
      montantCentimes: sl.montantCentimes,
      intituleParent: l.intitule,
      libelProposal: cleanLabel(sl.commercant),
    }));
  }
  return [
    {
      ligneBancaireId: l.id,
      sousLigneIndex: null,
      dateOperation: l.dateOperation,
      montantCentimes: l.montantCentimes,
      intituleParent: l.intitule,
      libelProposal: cleanLabel(l.intitule),
    },
  ];
}

export interface ScanDraftsResult {
  crees: number;
  existants: number;
  supprimes: number;
  // Lignes bancaires ignorées car le paiement est DÉJÀ comptabilisé dans CW
  // via une autre ligne identique (doublon du flux bancaire, ex. DSP2).
  doublons?: number;
  // Drafts NUS dont le type (dépense/recette) a été recalé sur le sens du
  // candidat courant — ex. sous-lignes DSP2 jadis créées à tort en recette
  // avant le fix de signe 2026-07-02.
  corriges?: number;
  erreur?: string;
}

export async function scanDraftsFromComptaweb(
  { groupId }: DraftsContext,
  db: DbWrapper = getDb(),
): Promise<ScanDraftsResult> {
  try {
    const data = await withAutoReLogin((cfg) => listRapprochementBancaire(cfg));

    // Jumeau déjà comptabilisé dans CW : même contenu exact (date+montant+type
    // +description, la description embarquant la réf de transaction unique →
    // identité fiable) ET relié à CW (comptaweb_ecriture_id non nul). Si présent,
    // la ligne bancaire courante est un DOUBLON du flux (le paiement est déjà
    // saisi via une autre ligne) : ne pas régénérer un draft qui serait aussitôt
    // re-flaggé `agrege_remplace` → boucle d'arbitrage sans fin (bug 2026-06-30,
    // ligne GABORIAUD remontée 2× en DSP2 pour 1 seul paiement réel).
    const findCwAccountedTwin = db.prepare(
      `SELECT id FROM ecritures
        WHERE group_id = ? AND date_ecriture = ? AND amount_cents = ? AND type = ?
          AND description = ? AND description <> ''
          AND comptaweb_ecriture_id IS NOT NULL
        LIMIT 1`,
    );
    const findMode = db.prepare('SELECT id FROM modes_paiement WHERE comptaweb_id = ? LIMIT 1');
    const findCarte = db.prepare(
      "SELECT id FROM cartes WHERE group_id = ? AND code_externe = ? AND statut = 'active' LIMIT 1",
    );
    const insert = db.prepare(
      `INSERT INTO ecritures (
         id, group_id, unite_id, date_ecriture, description, libelle_origine, amount_cents, type,
         category_id, mode_paiement_id, activite_id, numero_piece, status, justif_attendu,
         comptaweb_synced, ligne_bancaire_id, ligne_bancaire_sous_index,
         comptaweb_ecriture_id, carte_id, notes, created_at, updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'draft', ?, 0, ?, ?, NULL, ?, ?, ?, ?)`,
    );
    // Drafts existants d'une ligne, avec les flags du garde-fou de suppression
    // (statut, lien CW, imputation, pièce attachée) — cf. deleteDraftEcriture.
    const findLineDrafts = db.prepare(
      `SELECT e.id AS id,
              e.ligne_bancaire_sous_index AS sousIndex,
              e.status AS status,
              e.type AS type,
              e.comptaweb_ecriture_id AS cwId,
              (CASE WHEN e.category_id IS NOT NULL OR e.unite_id IS NOT NULL OR e.activite_id IS NOT NULL
                    THEN 1 ELSE 0 END) AS hasImput,
              (CASE WHEN EXISTS(SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id)
                      OR EXISTS(SELECT 1 FROM depots_justificatifs d WHERE d.ecriture_id = e.id)
                      OR EXISTS(SELECT 1 FROM remboursements r WHERE r.ecriture_id = e.id)
                    THEN 1 ELSE 0 END) AS hasAttach
       FROM ecritures e
       WHERE e.group_id = ? AND e.ligne_bancaire_id = ?`,
    );
    const deleteStaleDraft = db.prepare(
      `DELETE FROM ecritures WHERE id = ? AND group_id = ? AND status = 'draft'`,
    );
    // Self-heal : recale le sens d'un draft NU (+ justif_attendu cohérent) sans
    // toucher au montant (déjà stocké en absolu). Scopé status='draft' par
    // défense en profondeur.
    const correctDraftType = db.prepare(
      `UPDATE ecritures SET type = ?, justif_attendu = ?, updated_at = ?
        WHERE id = ? AND group_id = ? AND status = 'draft'`,
    );

    let crees = 0;
    let existants = 0;
    let supprimes = 0;
    let doublons = 0;
    let corriges = 0;

    for (const ligne of data.ecrituresBancaires) {
      const candidates = candidatesForLine(ligne);

      // 1. Réconciliation : retire les drafts fantômes de la ligne dont le
      //    sous_index n'est plus canonique (ex. draft « ligne entière »
      //    survivant après l'apparition des sous-lignes DSP2 → son montant =
      //    somme des sous-lignes → double comptage). Brouillons NUS seulement
      //    (le garde-fou est dans planStaleLineDrafts).
      const existingRows = await findLineDrafts.all<{
        id: string; sousIndex: number | null; status: string; type: string;
        cwId: number | null; hasImput: number; hasAttach: number;
      }>(groupId, ligne.id);
      const existing: ExistingLineDraft[] = existingRows.map((r) => ({
        id: r.id,
        sousLigneIndex: r.sousIndex,
        status: r.status,
        comptawebEcritureId: r.cwId,
        hasImputation: r.hasImput === 1,
        hasAttachment: r.hasAttach === 1,
      }));
      const canonical = candidates.map((c) => c.sousLigneIndex);
      const staleIds = new Set(planStaleLineDrafts(canonical, existing));
      for (const staleId of staleIds) {
        await deleteStaleDraft.run(staleId, groupId);
        supprimes++;
      }
      // Index des drafts restants par sous_index, pour retrouver le candidat
      // existant (et ses garde-fous) sans requête supplémentaire.
      const bySousIndex = new Map<number | null, (typeof existingRows)[number]>();
      for (const r of existingRows) {
        if (!staleIds.has(r.id)) bySousIndex.set(r.sousIndex, r);
      }

      // 2. Création des candidats manquants (clé (ligne, sous_index)).
      for (const c of candidates) {
        const type = c.montantCentimes < 0 ? 'depense' : 'recette';
        const amountAbs = Math.abs(c.montantCentimes);
        // Une entrée d'argent (recette) n'attend pas de justificatif : pas de
        // « à justifier », et au push pas de n° pièce de rattachement bidon.
        const justifAttendu = type === 'recette' ? 0 : 1;
        const existingCand = bySousIndex.get(c.sousLigneIndex);
        if (existingCand) {
          // Self-heal : recale le sens d'un draft LOCAL dont le type ne colle
          // plus au candidat recalculé (cas des sous-lignes DSP2 créées en
          // recette avant le fix de signe 2026-07-02). Sûr même sur un draft
          // imputé/rattaché : le `type` d'une écriture bancaire est 100% généré
          // (jamais éditable à la main), et la correction ne touche QUE
          // type + justif_attendu — imputation, lien dépôt, justifs, montant
          // absolu restent intacts (pas de suppression/recréation, donc rien à
          // réassocier). Seule barrière : ne jamais toucher une écriture déjà
          // matérialisée dans Comptaweb (status ≠ draft ou déjà liée à CW).
          const corrigeable = existingCand.status === 'draft' && existingCand.cwId === null;
          if (corrigeable && existingCand.type !== type) {
            await correctDraftType.run(type, justifAttendu, currentTimestamp(), existingCand.id, groupId);
            corriges++;
          } else {
            existants++;
          }
          continue;
        }
        // Doublon du flux bancaire : paiement déjà comptabilisé dans CW via une
        // autre ligne identique → ne pas régénérer (sinon boucle d'arbitrage).
        const twin = await findCwAccountedTwin.get(groupId, c.dateOperation, amountAbs, type, c.libelProposal);
        if (twin) { doublons++; continue; }
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
        // libelle_origine = libellé brut figé (= description initiale) : sert
        // au nudge « titre à renommer » et au rapprochement.
        await insert.run(id, groupId, c.dateOperation, c.libelProposal, c.libelProposal, amountAbs, type, modeLocal, justifAttendu, c.ligneBancaireId, c.sousLigneIndex, carteLocal, notes, now, now);
        crees++;
      }
    }

    return { crees, existants, supprimes, doublons, corriges };
  } catch (err) {
    if (err instanceof ComptawebSessionExpiredError) {
      return { crees: 0, existants: 0, supprimes: 0, erreur: 'Session Comptaweb expirée.' };
    }
    return { crees: 0, existants: 0, supprimes: 0, erreur: err instanceof Error ? err.message : String(err) };
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
  comptaweb_ecriture_id: number | null;
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
              unite_id, category_id, activite_id, mode_paiement_id, numero_piece, status, justif_attendu, carte_id,
              comptaweb_ecriture_id
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
    // L'écriture est sync-bloquée seulement si elle est DÉJÀ dans Comptaweb
    // (comptaweb_ecriture_id renseigné). Le status seul (draft / pending_*
    // / mirror) ne suffit pas : un user a pu marquer "miroir" manuellement
    // par erreur sans avoir réellement créé la ligne côté CW. On veut
    // quand même lui permettre de la sync ensuite.
    if (ecr.comptaweb_ecriture_id !== null) {
      missing.push(`déjà créée dans Comptaweb (id ${ecr.comptaweb_ecriture_id})`);
    }
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
    if (!numeropiece && hasJust) {
      const j = await db.prepare("SELECT id FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = ? ORDER BY uploaded_at LIMIT 1").get<{ id: string }>(ecr.id);
      if (j) numeropiece = j.id;
    }
    // Repli sur l'ID de l'écriture SEULEMENT si un justif est attendu/présent :
    // le n° pièce sert alors de code de rattachement de la pièce. Une recette
    // sans justif attendu part SANS n° pièce (pas de pièce bidon orpheline
    // côté Comptaweb). cf. demande terrain 2026-06-30.
    if (!numeropiece && (hasJust || ecr.justif_attendu)) {
      numeropiece = ecr.id;
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
    // Statut cible : `mirror` (le sync direct via UI ancien place déjà
    // l'écriture dans CW, donc on entre dans le miroir CW propre).
    // Phase 2 introduira `pending_cw` → `mirror` via le sync de retour ;
    // pour l'instant on reste sur le mapping 1:1 ancien `saisie_comptaweb`
    // → `mirror`.
    await db.prepare(
      `UPDATE ecritures SET status = 'mirror', comptaweb_synced = 1,
       comptaweb_ecriture_id = ?, numero_piece = ?, updated_at = ? WHERE id = ?`,
    ).run(result.ecritureId ?? null, numeropiece, currentTimestamp(), ecr.id);
    return { ok: true, message: `Synchronisé vers Comptaweb (id ${result.ecritureId}).`, dryRun: false, ecritureId: result.ecritureId };
  } catch (err) {
    if (err instanceof ComptawebSessionExpiredError) return { ok: false, message: 'Session Comptaweb expirée.', dryRun: opts.dryRun !== false };
    return { ok: false, message: err instanceof Error ? err.message : String(err), dryRun: opts.dryRun !== false };
  }
}
