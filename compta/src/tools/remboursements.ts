import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';
import { formatAmount, parseAmount } from '../utils.js';

interface RemboursementRow {
  id: string;
  amount_cents: number;
  [key: string]: unknown;
}

export function registerRemboursementTools(server: McpServer) {
  server.tool(
    'list_remboursements',
    'Liste les demandes de remboursement avec filtres optionnels',
    {
      status: z.enum(['demande', 'valide', 'paye', 'refuse']).optional(),
      unite_id: z.string().optional(),
      demandeur: z.string().optional().describe('Filtrer par nom du demandeur (recherche partielle)'),
      search: z.string().optional().describe('Recherche dans demandeur, nature et notes'),
      limit: z.number().default(50),
    },
    async (params) => {
      const rows = await api.get<RemboursementRow[]>('/api/remboursements', params);
      const result = rows.map((r) => ({ ...r, montant: formatAmount(r.amount_cents) }));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_remboursement',
    'Crée une nouvelle demande de remboursement',
    {
      demandeur: z.string().describe('Nom de la personne qui demande le remboursement'),
      montant: z.string().describe('Montant (ex: "42,50")'),
      date_depense: z.string().describe('Date de la dépense (YYYY-MM-DD)'),
      nature: z.string().describe('Nature de la dépense (transport, intendance, etc.)'),
      unite_id: z.string().optional().describe('Unité concernée (ex: u-lj)'),
      justificatif_status: z.enum(['oui', 'en_attente', 'non']).default('en_attente'),
      mode_paiement_id: z.string().optional().describe('Mode de paiement souhaité'),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await api.post<RemboursementRow>('/api/remboursements', {
        demandeur: params.demandeur,
        amount_cents: parseAmount(params.montant),
        date_depense: params.date_depense,
        nature: params.nature,
        unite_id: params.unite_id ?? null,
        justificatif_status: params.justificatif_status,
        mode_paiement_id: params.mode_paiement_id ?? null,
        notes: params.notes ?? null,
      });
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ...created, montant: formatAmount(created.amount_cents) }, null, 2) },
        ],
      };
    },
  );

  server.tool(
    'update_remboursement',
    'Met à jour un remboursement (statut, date de paiement, justificatif, etc.)',
    {
      id: z.string().describe('ID du remboursement (ex: RBT-2026-001)'),
      status: z.enum(['demande', 'valide', 'paye', 'refuse']).optional(),
      date_paiement: z.string().optional().describe('Date du paiement effectif (YYYY-MM-DD)'),
      mode_paiement_id: z.string().optional(),
      justificatif_status: z.enum(['oui', 'en_attente', 'non']).optional(),
      comptaweb_synced: z.boolean().optional(),
      ecriture_id: z.string().optional().describe("ID de l'écriture liée dans le journal"),
      notes: z.string().optional(),
    },
    async (params) => {
      const { id, ...patch } = params;
      const updated = await api.patch<RemboursementRow>(`/api/remboursements/${encodeURIComponent(id)}`, patch);
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ...updated, montant: formatAmount(updated.amount_cents) }, null, 2) },
        ],
      };
    },
  );
}
