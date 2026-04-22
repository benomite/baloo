import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { currentTimestamp, formatAmount, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';
import {
  withAutoReLogin,
  createEcriture,
  ComptawebSessionExpiredError,
} from '../comptaweb-client/index.js';
import type { CreateEcritureInput } from '../comptaweb-client/index.js';

// Défauts côté groupe courant (à externaliser dans la table groupes
// quand on aura du vrai multi-tenant).
const DEFAULT_TIERS_CATEG_ID = '4'; // Mon groupe
const DEFAULT_TIERS_STRUCTURE_ID = '498';
const DEFAULT_COMPTE_BANCAIRE_ID = '791';

interface EcritureRow {
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
  ligne_bancaire_id: number | null;
  ligne_bancaire_sous_index: number | null;
  comptaweb_ecriture_id: number | null;
}

interface RefComptawebRow { comptaweb_id: number | null; }

function isoToFr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Date ISO invalide : ${iso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function validateDraft(
  ecr: EcritureRow,
  refs: {
    natureCwId: number | null;
    activiteCwId: number | null;
    uniteCwId: number | null;
    modeCwId: number | null;
  },
  hasJustificatif: boolean,
): string[] {
  const errs: string[] = [];
  if (ecr.status !== 'brouillon') errs.push(`status '${ecr.status}' (seuls les drafts 'brouillon' peuvent être sync)`);
  if (!ecr.category_id) errs.push('category_id (nature) manquant');
  else if (refs.natureCwId === null) errs.push(`category_id=${ecr.category_id} n'a pas de comptaweb_id mappé (lancer map:referentiels)`);
  if (!ecr.activite_id) errs.push('activite_id manquant');
  else if (refs.activiteCwId === null) errs.push(`activite_id=${ecr.activite_id} n'a pas de comptaweb_id`);
  if (!ecr.unite_id) errs.push('unite_id (brancheprojet) manquant');
  else if (refs.uniteCwId === null) errs.push(`unite_id=${ecr.unite_id} n'a pas de comptaweb_id`);
  if (!ecr.mode_paiement_id) errs.push('mode_paiement_id manquant');
  else if (refs.modeCwId === null) errs.push(`mode_paiement_id=${ecr.mode_paiement_id} n'a pas de comptaweb_id (mode local sans équivalent, ex. 'Personnel')`);
  if (ecr.type === 'depense' && ecr.justif_attendu === 1 && !hasJustificatif && !ecr.numero_piece) {
    errs.push('justificatif manquant (dépense avec justif_attendu=1) : attacher via attach_justificatif, renseigner numero_piece, ou décocher justif_attendu');
  }
  return errs;
}

export function registerSyncDraftTool(server: McpServer) {
  server.tool(
    'cw_sync_draft',
    "Synchronise un draft BDD (status='brouillon') vers Comptaweb : crée l'écriture en prod, met à jour le draft en 'saisie_comptaweb' avec comptaweb_ecriture_id. Valide les obligatoires avant (nature/activité/unité/mode, justificatif si dépense). Dry-run par défaut.",
    {
      ecriture_id: z.string().describe("ID local de l'écriture draft (ex: ECR-2026-192)"),
      dry_run: z.boolean().optional().describe("Défaut true. Passer false pour réellement créer dans Comptaweb."),
      numeropiece_override: z.string().optional().describe("Permet d'injecter l'ID d'un justificatif Baloo (ex: JUS-2026-001) dans le champ numero_piece de Comptaweb."),
    },
    async ({ ecriture_id, dry_run, numeropiece_override }) => {
      const ctx = getCurrentContext();
      const db = getDb();
      const ecr = db.prepare(
        `SELECT id, group_id, date_ecriture, description, amount_cents, type,
                unite_id, category_id, activite_id, mode_paiement_id, numero_piece,
                status, justif_attendu, ligne_bancaire_id, ligne_bancaire_sous_index,
                comptaweb_ecriture_id
         FROM ecritures WHERE id = ? AND group_id = ?`,
      ).get(ecriture_id, ctx.groupId) as EcritureRow | undefined;

      if (!ecr) {
        return { content: [{ type: 'text', text: `Écriture ${ecriture_id} introuvable.` }], isError: true };
      }

      // Lookup des IDs Comptaweb associés aux références locales.
      const lookup = (table: string, id: string | null): number | null => {
        if (!id) return null;
        const row = db.prepare(`SELECT comptaweb_id FROM ${table} WHERE id = ?`).get(id) as RefComptawebRow | undefined;
        return row?.comptaweb_id ?? null;
      };
      const natureCwId = lookup('categories', ecr.category_id);
      const activiteCwId = lookup('activites', ecr.activite_id);
      const uniteCwId = lookup('unites', ecr.unite_id);
      const modeCwId = lookup('mode_paiement_id' as never, null); // placeholder — corrigé ci-dessous
      const modeCw = ecr.mode_paiement_id
        ? (db.prepare('SELECT comptaweb_id FROM modes_paiement WHERE id = ?').get(ecr.mode_paiement_id) as RefComptawebRow | undefined)
        : undefined;
      const modeCwIdReal = modeCw?.comptaweb_id ?? null;

      const justifRow = db.prepare(
        "SELECT COUNT(*) AS n FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = ?",
      ).get(ecr.id) as { n: number };
      const hasJustificatif = justifRow.n > 0;

      const errors = validateDraft(
        ecr,
        { natureCwId, activiteCwId, uniteCwId, modeCwId: modeCwIdReal },
        hasJustificatif,
      );

      if (errors.length && !dry_run) {
        return {
          content: [{ type: 'text', text: `Validation échouée :\n  - ${errors.join('\n  - ')}\nCompléter puis rappeler.` }],
          isError: true,
        };
      }

      // Construire l'input Comptaweb (même si validation échoue, pour montrer le
      // dry-run).
      let numeropieceValue = numeropiece_override ?? ecr.numero_piece ?? '';
      if (!numeropieceValue && hasJustificatif) {
        const firstJust = db.prepare(
          "SELECT id FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = ? ORDER BY uploaded_at LIMIT 1",
        ).get(ecr.id) as { id: string } | undefined;
        if (firstJust) numeropieceValue = firstJust.id;
      }

      const input: CreateEcritureInput = {
        type: ecr.type,
        libel: ecr.description,
        dateecriture: isoToFr(ecr.date_ecriture),
        montant: (ecr.amount_cents / 100).toFixed(2).replace('.', ','),
        numeropiece: numeropieceValue || undefined,
        modetransactionId: modeCwIdReal !== null ? String(modeCwIdReal) : '',
        comptebancaireId: DEFAULT_COMPTE_BANCAIRE_ID,
        tiersCategId: DEFAULT_TIERS_CATEG_ID,
        tiersStructureId: DEFAULT_TIERS_STRUCTURE_ID,
        ventilations: [
          {
            montant: (ecr.amount_cents / 100).toFixed(2).replace('.', ','),
            natureId: natureCwId !== null ? String(natureCwId) : '',
            activiteId: activiteCwId !== null ? String(activiteCwId) : '',
            brancheprojetId: uniteCwId !== null ? String(uniteCwId) : '',
          },
        ],
      };

      try {
        const result = await withAutoReLogin((cfg) => createEcriture(cfg, input, { dryRun: dry_run !== false }));

        if (result.dryRun) {
          return {
            content: [{
              type: 'text',
              text: [
                `DRY-RUN sur ${ecr.id} (${ecr.type}, ${formatAmount(ecr.amount_cents)}).`,
                errors.length ? `⚠ Validation :\n  - ${errors.join('\n  - ')}` : '✓ Validation OK.',
                `Source ligne bancaire : ${ecr.ligne_bancaire_id}${ecr.ligne_bancaire_sous_index !== null ? ` sous-ligne ${ecr.ligne_bancaire_sous_index}` : ''}`,
                `Comptaweb input :`,
                `  libel=${input.libel}`,
                `  date=${input.dateecriture}`,
                `  montant=${input.montant}`,
                `  modetransaction=${input.modetransactionId}`,
                `  numeropiece=${input.numeropiece ?? ''}`,
                `  ventilation: nature=${input.ventilations[0].natureId} activite=${input.ventilations[0].activiteId} branche=${input.ventilations[0].brancheprojetId}`,
                `\nPour créer, rappeler avec dry_run=false.`,
              ].join('\n'),
            }],
            isError: errors.length > 0,
          };
        }

        // Succès : mettre à jour le draft.
        db.prepare(
          `UPDATE ecritures SET status = 'saisie_comptaweb', comptaweb_synced = 1,
           comptaweb_ecriture_id = ?, updated_at = ? WHERE id = ?`,
        ).run(result.ecritureId ?? null, currentTimestamp(), ecr.id);

        return {
          content: [{
            type: 'text',
            text: `✓ Sync OK : ${ecr.id} → Comptaweb id ${result.ecritureId} (${result.detailsPath}). Draft passé en 'saisie_comptaweb'.`,
          }],
        };
      } catch (err) {
        if (err instanceof ComptawebSessionExpiredError) {
          return { content: [{ type: 'text', text: 'Session Comptaweb expirée.' }], isError: true };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Erreur Comptaweb : ${msg}` }], isError: true };
      }
    },
  );
}
