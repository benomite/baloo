import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  createRetraitEspecesAvecMouvement,
  attachRetraitEspecesToEcriture,
  listRetraitsEspecesEnAttente,
} from '@/lib/services/caisse';
import { formatAmount, parseAmount } from '@/lib/format';

// Retraits d'espèces (banque → caisse, #51) : le pendant des dépôts
// (depots-especes.ts). Un retrait est un mouvement de caisse positif de type
// 'retrait', lié au brouillon bancaire « Transfert interne — retrait
// d'espèces » par le n° de pièce qu'ils partagent.
export function registerRetraitsEspecesTools(server: McpServer, ctx: McpContext) {
  const caisseCtx = { groupId: ctx.groupId };
  const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

  server.tool(
    'list_retraits_especes',
    "Liste les retraits d'espèces (banque → caisse) pas encore rapprochés d'une écriture banque.",
    { limit: z.number().int().min(1).max(500).default(50) },
    async (params) => {
      const rows = await listRetraitsEspecesEnAttente(caisseCtx, params);
      return json(rows.map((m) => ({ ...m, montant: formatAmount(m.amount_cents) })));
    },
  );

  server.tool(
    'create_retrait_especes',
    "Enregistre un retrait d'espèces du compte banque vers la caisse (mouvement caisse positif). Avec `ecriture_id`, le retrait est créé déjà lié au brouillon bancaire « Transfert interne — retrait d'espèces ».",
    {
      date_retrait: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date du retrait (YYYY-MM-DD)'),
      montant: z.string().describe('Montant retiré (ex: "80,00")'),
      description: z.string().optional().describe('Libellé du mouvement caisse (défaut : "Retrait en banque <date>")'),
      notes: z.string().optional(),
      ecriture_id: z.string().optional().describe("ID de l'écriture banque (brouillon transfert interne) à lier"),
    },
    async (params) => {
      const { mouvement } = await createRetraitEspecesAvecMouvement(caisseCtx, {
        date_retrait: params.date_retrait,
        total_amount_cents: parseAmount(params.montant),
        description: params.description ?? null,
        notes: params.notes ?? null,
        ecriture_id: params.ecriture_id ?? null,
      });
      return json({ ...mouvement, montant: formatAmount(mouvement.amount_cents) });
    },
  );

  server.tool(
    'rapprocher_retrait_especes',
    "Lie un retrait d'espèces (mouvement caisse) à l'écriture banque correspondante : même n° de pièce des deux côtés, mouvement marqué 'rapproche'.",
    {
      mouvement_id: z.string().describe('ID du mouvement caisse de type retrait (CAI-XXX)'),
      ecriture_id: z.string().describe("ID de l'écriture banque (brouillon transfert interne)"),
    },
    async (params) => {
      const mouvement = await attachRetraitEspecesToEcriture(caisseCtx, params.mouvement_id, params.ecriture_id);
      return json({ ...mouvement, montant: formatAmount(mouvement.amount_cents) });
    },
  );
}
