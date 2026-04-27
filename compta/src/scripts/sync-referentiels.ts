// Synchronise les référentiels Comptaweb vers la BDD locale (branches/projets,
// natures, activités, modes de paiement). Voir sync-referentiels-logic.ts.
//
// Usage :
//   npx tsx src/scripts/sync-referentiels.ts

import { currentTimestamp, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';
import {
  applyReferentielsSync,
  fetchReferentielsCreer,
  fetchAllCartes,
  withAutoReLogin,
} from '../comptaweb-client/index.js';
import type { RefSyncStats } from '../comptaweb-client/index.js';

function printStats(label: string, s: RefSyncStats): void {
  const extras = s.orphelines.length ? `, ${s.orphelines.length} orpheline(s)` : '';
  console.log(
    `  ${label.padEnd(28)} ${s.ajoutees} ajout. · ${s.mappees} mappée(s) · ${s.inchangees} inchangée(s)${extras}`,
  );
  for (const id of s.orphelines) console.log(`    ⚠ orpheline : ${id}`);
}

async function main() {
  const ctx = getCurrentContext();
  console.log(`Sync référentiels Comptaweb pour groupe ${ctx.groupId} …`);
  const [refs, cartes] = await withAutoReLogin(async (cfg) => {
    const r = await fetchReferentielsCreer(cfg);
    const c = await fetchAllCartes(cfg);
    return [r, c] as const;
  });
  console.log(
    `Reçu : ${refs.brancheprojet.length} branches/projets, ${refs.nature.length} natures, ${refs.activite.length} activités, ${refs.modetransaction.length} modes, ${cartes.length} cartes.`,
  );
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
  console.log('\nRapport :');
  printStats('Unités (branchesprojets)', report.unites);
  printStats('Natures (categories)', report.categories);
  printStats('Activités', report.activites);
  printStats('Modes de paiement', report.modes_paiement);
  printStats('Cartes (CB + procurement)', report.cartes);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
