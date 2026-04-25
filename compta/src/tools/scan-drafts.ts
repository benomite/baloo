import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { currentTimestamp, getDb, nextId } from '../db.js';
import { getCurrentContext } from '../context.js';
import {
  withAutoReLogin,
  listRapprochementBancaire,
  ComptawebSessionExpiredError,
} from '../comptaweb-client/index.js';
import type {
  EcritureBancaireNonRapprochee,
  SousLigneDsp2,
} from '../comptaweb-client/index.js';

interface CandidateLigne {
  ligneBancaireId: number;
  sousLigneIndex: number | null;
  dateOperation: string; // ISO YYYY-MM-DD
  montantCentimes: number; // signé
  intituleParent: string;
  libelProposal: string;
}

function cleanLabel(label: string): string {
  return label
    .replace(/\s+\d{6,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function inferComptawebModeId(intituleParent: string): number | null {
  const s = intituleParent.toUpperCase();
  if (s.startsWith('VIR ') || s.includes(' VIR ') || s.includes('VIREMENT') || s.includes('VIR DE ')) return 1; // Virement
  if (s.includes('PAIEMENT C. PROC') || s.includes('CARTE PROCUREMENT')) return 9; // Carte procurement
  if (s.includes('PAIEMENT PAR CB') || s.includes('CARTE BANCAIRE')) return 3; // Carte bancaire
  if (s.includes('PRLV') || s.includes('PRELEVEMENT')) return null; // pas de mapping local
  return null;
}

function listCandidates(
  ecrituresBancaires: EcritureBancaireNonRapprochee[],
): CandidateLigne[] {
  const out: CandidateLigne[] = [];
  for (const l of ecrituresBancaires) {
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

// DEPRECATED (chantier 1, doc/p2-pivot-webapp.md) : sera retiré au chantier 3.
// La logique de scan des drafts depuis le rapprochement bancaire Comptaweb
// migrera côté backend webapp au chantier 6.
export function registerScanDraftsTool(server: McpServer) {
  server.tool(
    'cw_scan_drafts',
    "Scanne les lignes bancaires non rapprochées Comptaweb et crée un draft (status='brouillon') dans la table ecritures locale pour chaque ligne (ou sous-ligne DSP2) non encore matérialisée. Idempotent : ne recrée pas de draft si un existe déjà pour (ligne_bancaire_id, sous_index), et ne touche pas aux drafts déjà complétés ou synchronisés.",
    {},
    async () => {
      try {
        const data = await withAutoReLogin((cfg) => listRapprochementBancaire(cfg));
        const ctx = getCurrentContext();
        const db = getDb();
        const candidates = listCandidates(data.ecrituresBancaires);

        const findExisting = db.prepare(
          `SELECT id, status, description FROM ecritures
           WHERE group_id = ? AND ligne_bancaire_id = ?
             AND (ligne_bancaire_sous_index IS ? OR ligne_bancaire_sous_index = ?)
           LIMIT 1`,
        );

        const findModePaiement = db.prepare(
          'SELECT id FROM modes_paiement WHERE comptaweb_id = ? LIMIT 1',
        );

        const insertEcriture = db.prepare(
          `INSERT INTO ecritures (
             id, group_id, unite_id, date_ecriture, description, amount_cents, type,
             category_id, mode_paiement_id, activite_id, numero_piece, status,
             comptaweb_synced, ligne_bancaire_id, ligne_bancaire_sous_index,
             comptaweb_ecriture_id, notes, created_at, updated_at
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'brouillon', 0, ?, ?, NULL, ?, ?, ?)`,
        );

        const created: string[] = [];
        const skippedExisting: string[] = [];

        for (const c of candidates) {
          const existing = findExisting.get(
            ctx.groupId,
            c.ligneBancaireId,
            c.sousLigneIndex,
            c.sousLigneIndex,
          ) as { id: string; status: string } | undefined;
          if (existing) {
            skippedExisting.push(`${existing.id} (${existing.status})`);
            continue;
          }

          const type: 'depense' | 'recette' = c.montantCentimes < 0 ? 'depense' : 'recette';
          const amountAbs = Math.abs(c.montantCentimes);
          const comptawebModeId = inferComptawebModeId(c.intituleParent);
          let modePaiementLocalId: string | null = null;
          if (comptawebModeId !== null) {
            const row = findModePaiement.get(comptawebModeId) as { id: string } | undefined;
            modePaiementLocalId = row?.id ?? null;
          }

          const id = nextId('ECR');
          const now = currentTimestamp();
          const notes = c.sousLigneIndex !== null
            ? `Draft généré depuis ligne bancaire ${c.ligneBancaireId} sous-ligne ${c.sousLigneIndex} (intitulé parent: ${c.intituleParent.slice(0, 80)}).`
            : `Draft généré depuis ligne bancaire ${c.ligneBancaireId}.`;

          insertEcriture.run(
            id,
            ctx.groupId,
            c.dateOperation,
            c.libelProposal,
            amountAbs,
            type,
            modePaiementLocalId,
            c.ligneBancaireId,
            c.sousLigneIndex,
            notes,
            now,
            now,
          );
          created.push(`${id}  ${c.dateOperation}  ${type === 'depense' ? '-' : '+'}${(amountAbs / 100).toFixed(2)} €  ${c.libelProposal}`);
        }

        const summary = {
          total_candidats: candidates.length,
          drafts_crees: created.length,
          drafts_existants: skippedExisting.length,
          exemples_crees: created.slice(0, 15),
          existants: skippedExisting.slice(0, 10),
        };
        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
      } catch (err) {
        if (err instanceof ComptawebSessionExpiredError) {
          return { content: [{ type: 'text', text: 'Session Comptaweb expirée.' }], isError: true };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Erreur : ${msg}` }], isError: true };
      }
    },
  );
}
