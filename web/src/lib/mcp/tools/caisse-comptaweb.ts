// Tools MCP du cycle de vie caisse ↔ Comptaweb (#61).
//
// Exception assumée à « l'agent MCP ne pousse rien dans Comptaweb » (ADR-037) :
// le ticket #61 demande que chaque capacité de la caisse soit un tool MCP,
// envoi à Comptaweb compris. L'envoi reste en deux temps, comme la validation
// d'un brouillon bancaire : preview (dry_run, défaut) puis envoi réel.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listMouvementsCaisseBalooOnly,
  pushMouvementCaisseToComptaweb,
  rapprocherMouvementCaisseComptaweb,
  updateMouvementCaisseAvantComptaweb,
} from '@/lib/services/caisse-comptaweb';
import { formatAmount, parseAmount } from '@/lib/format';
import type { MouvementCaisse } from '@/lib/types';

function texte(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function avecMontant(m: MouvementCaisse) {
  return { ...m, montant: formatAmount(m.amount_cents) };
}

export function registerCaisseComptawebTools(server: McpServer, ctx: McpContext) {
  const caisseCtx = { groupId: ctx.groupId, scopeUniteIds: ctx.scopeUniteIds ?? null };

  server.tool(
    'list_mouvements_caisse_baloo_only',
    "Liste les mouvements de caisse qui n'existent que dans Baloo : ni brouillon (draft / pending_sync), ni miroir d'une ligne de caisse Comptaweb, ni archivés. Chacun se résout par push_mouvement_caisse_comptaweb (l'envoyer à Comptaweb) ou rapprocher_mouvement_caisse_comptaweb (le lier à une ligne de caisse CW existante, cf. list_mouvements_caisse : comptaweb_ecriture_id). Les dépôts/retraits d'espèces se résolvent par leur brouillon bancaire (transfert interne) ou par rapprochement.",
    {},
    async () => {
      const mouvements = await listMouvementsCaisseBalooOnly(caisseCtx);
      return texte({
        total: mouvements.length,
        montant_total: formatAmount(mouvements.reduce((s, m) => s + m.amount_cents, 0)),
        mouvements: mouvements.map(avecMontant),
      });
    },
  );

  server.tool(
    'update_mouvement_caisse',
    "Complète ou corrige un mouvement de caisse pas encore dans Comptaweb (brouillon ou Baloo-only) : nature, unité, activité, date, libellé, montant, notes. Refusé pour un miroir CW ou un envoi en attente (Comptaweb fait foi).",
    {
      mouvement_id: z.string().describe('ID du mouvement (CAI-…)'),
      date_mouvement: z.string().optional().describe('YYYY-MM-DD'),
      description: z.string().optional(),
      montant: z.string().optional().describe('Montant signé : "+15,00" entrée, "-8,50" sortie'),
      category_id: z.string().optional().describe('Nature (cf. list_categories)'),
      unite_id: z.string().optional(),
      activite_id: z.string().optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      try {
        const m = await updateMouvementCaisseAvantComptaweb(caisseCtx, params.mouvement_id, {
          date_mouvement: params.date_mouvement,
          description: params.description,
          amount_cents: params.montant !== undefined ? parseAmount(params.montant) : undefined,
          category_id: params.category_id,
          unite_id: params.unite_id,
          activite_id: params.activite_id,
          notes: params.notes,
        });
        return texte(avecMontant(m));
      } catch (err) {
        return texte({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );

  server.tool(
    'push_mouvement_caisse_comptaweb',
    "Envoie un mouvement de caisse (brouillon ou Baloo-only) dans la caisse Comptaweb. Validé comme un brouillon bancaire : mode Espèces, nature, unité, activité et leurs correspondances CW pour l'exercice de la date. dry_run=true (défaut) : preview sans rien créer ; dry_run=false : crée l'écriture CW, le mouvement passe en pending_sync, et le sync_run suivant le reconnaît comme la ligne CW (pas de doublon). Les dépôts/retraits d'espèces partent par leur brouillon bancaire, pas d'ici.",
    {
      mouvement_id: z.string().describe('ID du mouvement (CAI-…)'),
      dry_run: z.boolean().default(true).describe('true = preview, false = envoi réel'),
    },
    async (params) => {
      try {
        const r = await pushMouvementCaisseToComptaweb(caisseCtx, params.mouvement_id, {
          dryRun: params.dry_run,
        });
        return texte(r, !r.ok);
      } catch (err) {
        return texte({ ok: false, message: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );

  server.tool(
    'rapprocher_mouvement_caisse_comptaweb',
    "Rapproche un mouvement de caisse Baloo-only d'une ligne de caisse Comptaweb existante, choisie par l'utilisateur (son comptaweb_ecriture_id, cf. list_mouvements_caisse). Si la ligne CW est déjà importée dans Baloo, le miroir est gardé (complété de l'unité/activité/notes saisies) et le mouvement Baloo-only est archivé, jamais supprimé ; sinon le mouvement devient le miroir de cette ligne. Signale les écarts de montant ou de date.",
    {
      mouvement_id: z.string().describe('ID du mouvement Baloo-only (CAI-…)'),
      comptaweb_ecriture_id: z
        .number()
        .int()
        .positive()
        .describe('Id Comptaweb de la ligne de caisse choisie'),
    },
    async (params) => {
      try {
        const r = await rapprocherMouvementCaisseComptaweb(
          caisseCtx,
          params.mouvement_id,
          params.comptaweb_ecriture_id,
        );
        return texte({ ...r, mouvement: avecMontant(r.mouvement) });
      } catch (err) {
        return texte({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );
}
