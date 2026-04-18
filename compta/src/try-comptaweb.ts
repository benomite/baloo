import { loadConfig, listRapprochementBancaire } from './comptaweb-client/index.js';

function formatEur(centimes: number): string {
  const euros = centimes / 100;
  const fmt = euros.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt} €`;
}

async function main() {
  const config = loadConfig();
  console.log(`→ Requête GET ${config.baseUrl}/rapprochementbancaire?m=1`);
  const data = await listRapprochementBancaire(config);

  console.log(`\nCompte : ${data.libelleCompte} (id=${data.idCompte})`);

  console.log(`\nÉcritures comptables non rapprochées (${data.ecrituresComptables.length}) :`);
  for (const ec of data.ecrituresComptables) {
    console.log(`  · [${ec.id}] ${ec.dateEcriture} ${ec.type.padEnd(10)} ${formatEur(ec.montantCentimes).padStart(12)}  ${ec.intitule}`);
  }

  console.log(`\nÉcritures bancaires non rapprochées (${data.ecrituresBancaires.length}) :`);
  for (const eb of data.ecrituresBancaires) {
    console.log(`  · [${eb.id}] ${eb.dateOperation}  ${formatEur(eb.montantCentimes).padStart(12)}  ${eb.intitule}`);
    for (const sl of eb.sousLignes) {
      console.log(`      ${formatEur(sl.montantCentimes).padStart(12)}  ${sl.commercant}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
