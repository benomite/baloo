import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../auth';
import type { SyncReferentielsReport } from '@/lib/comptaweb';
import {
  syncReferentielsTousExercices,
  type SyncReferentielsTousExercicesReport,
} from '@/lib/services/referentiels-sync';

function formatStats(label: string, s: SyncReferentielsReport['unites']): string {
  const parts = [
    `${s.ajoutees} ajoutée${s.ajoutees > 1 ? 's' : ''}`,
    `${s.mappees} mappée${s.mappees > 1 ? 's' : ''}`,
    `${s.inchangees} inchangée${s.inchangees > 1 ? 's' : ''}`,
  ];
  if (s.orphelines.length)
    parts.push(`${s.orphelines.length} orpheline${s.orphelines.length > 1 ? 's' : ''}`);
  return `${label}: ${parts.join(', ')}`;
}

function formatReport(r: SyncReferentielsTousExercicesReport): string {
  const lines = [
    `Exercices : ${r.exercices.join(', ')}`,
    formatStats('Unités (branches/projets)', r.unites),
    formatStats('Natures (catégories)', r.categories),
    formatStats('Activités', r.activites),
    formatStats('Modes de paiement', r.modes_paiement),
    formatStats('Cartes (CB + procurement)', r.cartes),
  ];
  const orphelines = [
    ...r.unites.orphelines.map((id) => `unite ${id}`),
    ...r.categories.orphelines.map((id) => `categorie ${id}`),
    ...r.activites.orphelines.map((id) => `activite ${id}`),
    ...r.modes_paiement.orphelines.map((id) => `mode ${id}`),
    ...r.cartes.orphelines.map((id) => `carte ${id}`),
  ];
  if (orphelines.length) {
    lines.push('', "Orphelines (entrées locales absentes de Comptaweb sur l'exercice le plus récent) :");
    lines.push(...orphelines.map((o) => `  - ${o}`));
  }
  return lines.join('\n');
}

export function registerSyncReferentielsTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'cw_sync_referentiels',
    "Synchronise les référentiels Comptaweb (branches/projets → unites, natures → categories, activités → activites, modes de transaction → modes_paiement, cartes CB + procurement → cartes) sur chaque exercice actif. Comptaweb renumérote unités et activités à chaque exercice : leurs IDs sont tenus par exercice, l'unité locale restant unique (rattachée par nom). Additif : ajoute les entrées manquantes, signale les orphelines. Ne supprime jamais.",
    {},
    async () => {
      try {
        const report = await syncReferentielsTousExercices(ctx.groupId);
        return { content: [{ type: 'text' as const, text: formatReport(report) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Sync échouée : ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
