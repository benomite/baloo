// CLI : synchronise les référentiels Comptaweb vers la BDD locale via
// l'API HTTP de la webapp (POST /api/comptaweb/sync-referentiels).
//
// Usage :
//   npx tsx src/scripts/sync-referentiels.ts
//
// Prérequis : `web/` doit tourner (BALOO_API_URL pointer dessus) et
// `BALOO_API_TOKEN` doit être valide.

import { api } from '../api-client.js';

interface RefSyncStats {
  ajoutees: number;
  mappees: number;
  inchangees: number;
  orphelines: string[];
}

interface SyncReport {
  unites: RefSyncStats;
  categories: RefSyncStats;
  activites: RefSyncStats;
  modes_paiement: RefSyncStats;
  cartes: RefSyncStats;
}

interface SyncResult {
  ok: boolean;
  report?: SyncReport;
  erreur?: string;
}

function printStats(label: string, s: RefSyncStats): void {
  const extras = s.orphelines.length ? `, ${s.orphelines.length} orpheline(s)` : '';
  console.log(
    `  ${label.padEnd(28)} ${s.ajoutees} ajout. · ${s.mappees} mappée(s) · ${s.inchangees} inchangée(s)${extras}`,
  );
  for (const id of s.orphelines) console.log(`    ⚠ orpheline : ${id}`);
}

async function main() {
  console.log('Sync référentiels Comptaweb via API webapp …');
  const result = await api.post<SyncResult>('/api/comptaweb/sync-referentiels', {});
  if (!result.ok || !result.report) {
    console.error(`Erreur : ${result.erreur ?? 'sync échouée.'}`);
    process.exit(1);
  }
  const r = result.report;
  console.log('\nRapport :');
  printStats('Unités (branchesprojets)', r.unites);
  printStats('Natures (categories)', r.categories);
  printStats('Activités', r.activites);
  printStats('Modes de paiement', r.modes_paiement);
  printStats('Cartes (CB + procurement)', r.cartes);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
