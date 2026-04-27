// Marque `justif_attendu = 0` sur les dépenses qui correspondent à des flux
// automatiques SGDF / territoriaux (prélèvements nationaux regroupés,
// contributions territoire, assurance, adhésions fiscalisées) — ces lignes
// n'ont pas de "justif papier", leur référence vit côté portail SGDF.
//
// Dry-run par défaut : affiche les lignes qui seraient modifiées.
// Passer `--apply` pour exécuter la mise à jour.
//
// Usage :
//   pnpm flag:prelevements-auto
//   pnpm flag:prelevements-auto --apply

import { getDb } from '../src/lib/db';
import { currentTimestamp } from '../src/lib/ids';
import { formatAmount } from '../src/lib/format';

interface Row {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  has_justif: number;
  numero_piece: string | null;
}

const PATTERNS = [
  'Regroupement%',         // "Regroupement de X prélèvements nationaux"
  'Cumul 61%',             // assurance
  'Cumul 65%',             // cotisations / adhésions
  'Appel de fond%',        // appel de fonds territoire
  'Contribution fct territoire%',
  '%Adhésion fiscalisée%',
];

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  const includeWithJustif = process.argv.includes('--include-with-justif');

  const whereLikes = PATTERNS.map(() => 'description LIKE ?').join(' OR ');
  const rows = await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.numero_piece,
              EXISTS(SELECT 1 FROM justificatifs j WHERE j.entity_type='ecriture' AND j.entity_id=e.id) AS has_justif
       FROM ecritures e
       WHERE e.type = 'depense'
         AND e.justif_attendu = 1
         AND (${whereLikes})
       ORDER BY e.date_ecriture`,
    )
    .all<Row>(...PATTERNS);

  if (rows.length === 0) {
    console.log('Aucune dépense ne matche les patterns de prélèvement auto.');
    return;
  }

  const eligible = rows.filter((r) => includeWithJustif || !r.has_justif);
  const skipped = rows.filter((r) => !includeWithJustif && r.has_justif);

  let totalCents = 0;
  console.log(`${apply ? 'Mise à jour' : 'DRY-RUN — à modifier'} : ${eligible.length} dépense(s)\n`);
  for (const r of eligible) {
    totalCents += r.amount_cents;
    const hints: string[] = [];
    if (r.numero_piece) hints.push(`numero_piece=${r.numero_piece}`);
    console.log(
      `  ${r.id}  ${r.date_ecriture}  ${formatAmount(r.amount_cents).padStart(12)}  ${r.description}` +
        (hints.length ? `  [${hints.join(', ')}]` : ''),
    );
  }
  console.log(`\nTotal : ${formatAmount(totalCents)}`);

  if (skipped.length > 0) {
    console.log(`\nIgnorées (ont déjà un justif rattaché) : ${skipped.length}`);
    for (const r of skipped) {
      console.log(`  ${r.id}  ${r.date_ecriture}  ${formatAmount(r.amount_cents).padStart(12)}  ${r.description}`);
    }
    console.log('\nPour les inclure quand même, relancer avec --include-with-justif.');
  }

  if (!apply) {
    console.log('\nRien écrit. Relancer avec --apply pour marquer justif_attendu = 0.');
    return;
  }

  if (eligible.length === 0) {
    console.log('\nAucune ligne éligible à mettre à jour.');
    return;
  }

  const now = currentTimestamp();
  const ids = eligible.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const result = await db
    .prepare(`UPDATE ecritures SET justif_attendu = 0, updated_at = ? WHERE id IN (${placeholders})`)
    .run(now, ...ids);
  console.log(`\n✓ ${result.changes} écriture(s) mises à jour (justif_attendu = 0).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
