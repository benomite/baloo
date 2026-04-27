import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { currentTimestamp, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';
import {
  applyReferentielsSync,
  fetchReferentielsCreer,
  fetchAllCartes,
  withAutoReLogin,
  ComptawebSessionExpiredError,
} from '../comptaweb-client/index.js';
import type { SyncReferentielsReport, RefSyncStats } from '../comptaweb-client/index.js';

function formatStats(label: string, s: RefSyncStats): string {
  const parts = [
    `${s.ajoutees} ajoutée${s.ajoutees > 1 ? 's' : ''}`,
    `${s.mappees} mappée${s.mappees > 1 ? 's' : ''}`,
    `${s.inchangees} inchangée${s.inchangees > 1 ? 's' : ''}`,
  ];
  if (s.orphelines.length) parts.push(`${s.orphelines.length} orpheline${s.orphelines.length > 1 ? 's' : ''}`);
  return `${label}: ${parts.join(', ')}`;
}

function formatReport(r: SyncReferentielsReport): string {
  const lines = [
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
    lines.push('', 'Orphelines (entrées locales avec comptaweb_id introuvable côté CW) :');
    lines.push(...orphelines.map((o) => `  - ${o}`));
  }
  return lines.join('\n');
}

export function registerSyncReferentielsTool(server: McpServer) {
  server.tool(
    'cw_sync_referentiels',
    "Synchronise les référentiels Comptaweb (branches/projets → unites, natures → categories, activités → activites, modes de transaction → modes_paiement). Additif : ajoute les entrées manquantes, mappe les entrées locales non mappées par name, signale les orphelines. Ne supprime jamais.",
    {},
    async () => {
      try {
        const ctx = getCurrentContext();
        const [refs, cartes] = await withAutoReLogin(async (cfg) => {
          const r = await fetchReferentielsCreer(cfg);
          const c = await fetchAllCartes(cfg);
          return [r, c] as const;
        });
        const report = applyReferentielsSync(
          getDb(),
          ctx.groupId,
          {
            brancheprojet: refs.brancheprojet,
            nature: refs.nature,
            activite: refs.activite,
            modetransaction: refs.modetransaction,
            cartes,
          },
          currentTimestamp(),
        );
        return {
          content: [{ type: 'text', text: formatReport(report) }],
        };
      } catch (err) {
        if (err instanceof ComptawebSessionExpiredError) {
          return {
            content: [{ type: 'text', text: 'Session Comptaweb expirée.' }],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Erreur : ${msg}` }], isError: true };
      }
    },
  );
}
