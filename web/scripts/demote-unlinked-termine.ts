// Script ponctuel : rétrograde de `termine` à `virement_effectue` les
// demandes de remboursement qui n'ont pas d'écriture comptable liée.
//
// Contexte : suite à l'introduction de la garde "→ termine exige
// `ecriture_id`", les rembs importées d'Airtable qui étaient en
// `termine` sans `ecriture_id` (les 3 sans match auto) doivent être
// remises au cran précédent pour qu'elles tombent dans le filtre
// "À rattacher".
//
// Idempotent : ne touche que les rembs `status='termine' AND
// ecriture_id IS NULL`. Aucun effet sur les rembs déjà liées.
//
// Usage :
//   pnpm exec tsx --env-file=.env.prod scripts/demote-unlinked-termine.ts [--apply]

import { ensureComptawebEnv } from '../src/lib/comptaweb/env-loader';
import { getDb } from '../src/lib/db';

async function main() {
  ensureComptawebEnv();

  if (!process.env.DB_URL) {
    console.error('DB_URL requis (Turso prod).');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  if (!apply) {
    console.log('[mode dry-run — passe --apply pour écrire]\n');
  }

  const db = getDb();

  const targets = await db
    .prepare(
      `SELECT id, demandeur, amount_cents, date_depense
       FROM remboursements
       WHERE status = 'termine' AND ecriture_id IS NULL
       ORDER BY id`,
    )
    .all<{ id: string; demandeur: string; amount_cents: number; date_depense: string | null }>();

  console.log(`${targets.length} demande(s) à rétrograder.\n`);

  for (const r of targets) {
    console.log(
      `  ${apply ? '↓' : '·'} ${r.id} · ${r.demandeur} · ${(r.amount_cents / 100).toFixed(2)}€ · ${r.date_depense ?? '?'}`,
    );
  }

  if (apply && targets.length > 0) {
    await db.exec(
      "UPDATE remboursements SET status = 'virement_effectue', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE status = 'termine' AND ecriture_id IS NULL",
    );
    console.log(`\n${targets.length} demande(s) rétrogradée(s) en \`virement_effectue\`.`);
  } else if (!apply) {
    console.log(`\nRelance avec --apply pour écrire.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
