// Lie les demandes de remboursement importées (depuis Airtable, ou
// natives) aux écritures comptables qui correspondent au virement.
//
// Stratégie de matching :
//   1. Pour chaque rembs avec `ecriture_id IS NULL`, on cherche des
//      écritures `type='depense'` du même groupe, montant exact, dans
//      une fenêtre date élargie autour de `date_depense`.
//   2. Score chaque candidat sur l'apparition du nom/prénom dans la
//      description et la proximité de date.
//   3. Si UN candidat sort largement (>= seuil + unique) → auto-link.
//   4. Sinon → log les candidats avec leurs scores, l'humain tranche.
//
// Idempotent : ne touche que les rembs `ecriture_id IS NULL` ; les
// liens déjà faits sont conservés.
//
// Usage :
//   set -a; source .env.prod; set +a   (ou tsx --env-file=)
//   pnpm tsx scripts/link-rembs-to-ecritures.ts [--dry-run] [--apply]
//
// `--dry-run` (par défaut) : montre les matchs proposés, n'écrit rien.
// `--apply` : écrit l'`ecriture_id` quand le match est sûr (score >= 80
// ET candidat unique au-dessus du seuil).

import { ensureComptawebEnv } from '../src/lib/comptaweb/env-loader';
import { getDb } from '../src/lib/db';

interface RembsRow {
  id: string;
  group_id: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  amount_cents: number;
  date_depense: string | null;
  nature: string | null;
}

interface EcritureCandidate {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
}

interface ScoredCandidate extends EcritureCandidate {
  score: number;
  reasons: string[];
}

// Fenêtre date élargie : un virement peut être fait jusqu'à 4 mois
// après la soumission de la demande (cas réels observés).
const DATE_WINDOW_DAYS = 120;

// Seuil pour auto-link : un nom détecté + cohérence date.
const AUTO_LINK_SCORE = 80;

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCandidate(rembs: RembsRow, c: EcritureCandidate): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;

  // Match nom (haute valeur — un libellé bancaire de virement contient
  // souvent "VIR M. DUPONT JEAN" ou similaire).
  const desc = normalize(c.description);
  const nom = rembs.nom ? normalize(rembs.nom) : '';
  const prenom = rembs.prenom ? normalize(rembs.prenom) : '';
  if (nom && nom.length > 2 && desc.includes(nom)) {
    score += 60;
    reasons.push(`nom "${rembs.nom}"`);
  }
  if (prenom && prenom.length > 2 && desc.includes(prenom)) {
    score += 25;
    reasons.push(`prénom "${rembs.prenom}"`);
  }

  // Proximité date.
  if (rembs.date_depense) {
    const days = daysBetween(rembs.date_depense, c.date_ecriture);
    if (days <= 15) {
      score += 20;
      reasons.push(`date ±${Math.round(days)}j`);
    } else if (days <= 45) {
      score += 10;
      reasons.push(`date ±${Math.round(days)}j`);
    } else {
      reasons.push(`date ±${Math.round(days)}j (large)`);
    }
  }

  return { ...c, score, reasons };
}

async function main() {
  ensureComptawebEnv();

  if (!process.env.DB_URL) {
    console.error('DB_URL requis (Turso prod).');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  if (!apply) {
    console.log('[mode dry-run — passe --apply pour écrire les liens]\n');
  }

  const db = getDb();

  // Rembs sans ecriture_id, par ordre de date.
  const rembs = await db
    .prepare(
      `SELECT id, group_id, prenom, nom, email, amount_cents, date_depense, nature
       FROM remboursements
       WHERE ecriture_id IS NULL
       ORDER BY date_depense, id`,
    )
    .all<RembsRow>();

  console.log(`${rembs.length} rembs sans \`ecriture_id\`.\n`);

  let autoLinked = 0;
  let ambiguous = 0;
  let noMatch = 0;

  for (const r of rembs) {
    const fromDate = r.date_depense
      ? new Date(new Date(r.date_depense).getTime() - DATE_WINDOW_DAYS * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;
    const toDate = r.date_depense
      ? new Date(new Date(r.date_depense).getTime() + DATE_WINDOW_DAYS * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;

    if (!fromDate || !toDate) {
      console.log(`⊘ ${r.id} : pas de date_depense, skip`);
      noMatch++;
      continue;
    }

    // Candidats : même groupe, même montant, dépense, dans la fenêtre,
    // pas déjà liés à une autre rembs.
    const candidates = await db
      .prepare(
        `SELECT id, date_ecriture, description, amount_cents
         FROM ecritures
         WHERE group_id = ?
           AND type = 'depense'
           AND amount_cents = ?
           AND date_ecriture BETWEEN ? AND ?
           AND id NOT IN (
             SELECT ecriture_id FROM remboursements
             WHERE ecriture_id IS NOT NULL
           )
         ORDER BY date_ecriture`,
      )
      .all<EcritureCandidate>(r.group_id, r.amount_cents, fromDate, toDate);

    if (candidates.length === 0) {
      console.log(
        `⊘ ${r.id} (${r.prenom ?? ''} ${r.nom ?? ''} · ${(r.amount_cents / 100).toFixed(2)}€ · ${r.date_depense}) : aucune écriture candidate`,
      );
      noMatch++;
      continue;
    }

    const scored = candidates
      .map((c) => scoreCandidate(r, c))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];

    const summary = `${r.id} (${r.prenom ?? ''} ${r.nom ?? ''} · ${(r.amount_cents / 100).toFixed(2)}€ · ${r.date_depense})`;
    const isUniqueWinner = !second || best.score - second.score >= 30;
    const goodEnough = best.score >= AUTO_LINK_SCORE;

    if (goodEnough && isUniqueWinner) {
      console.log(
        `✓ ${summary} → ${best.id} (${best.date_ecriture}, score ${best.score}, ${best.reasons.join(' / ')})`,
      );
      autoLinked++;
      if (apply) {
        await db
          .prepare(
            `UPDATE remboursements
             SET ecriture_id = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(best.id, new Date().toISOString(), r.id);
      }
    } else {
      ambiguous++;
      console.log(`? ${summary} : ${candidates.length} candidat(s), top ${Math.min(3, scored.length)} :`);
      for (const c of scored.slice(0, 3)) {
        console.log(
          `    score=${String(c.score).padStart(3)}  ${c.id}  ${c.date_ecriture}  ${c.description.slice(0, 60).padEnd(60)}  (${c.reasons.join(' / ')})`,
        );
      }
    }
  }

  console.log();
  console.log(
    `Bilan : ${autoLinked} ${apply ? 'liés' : 'liables'} · ${ambiguous} ambigus · ${noMatch} sans candidat`,
  );
  if (!apply && autoLinked > 0) {
    console.log(`\nRelance avec --apply pour écrire les ${autoLinked} liens auto.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
