// Contrôles de cohérence d'un exercice, en lecture seule.
//
//   pnpm export:controles              -> exercice courant
//   pnpm export:controles 2025-2026    -> exercice explicite
//
// À lancer AVANT de déclarer un exercice clos : le rapport dit ce qui manque
// pendant qu'il est encore temps de le corriger.
import { getDb } from '../src/lib/db';
import { currentExercice } from '../src/lib/services/overview';
import { bornesPourExercice } from '../src/lib/services/export/bornes';
import { rapportControles, formatRapportTexte } from '../src/lib/services/export/controles';
import { getCliContext } from './cli-context';

async function main() {
  const exercice = process.argv[2] ?? currentExercice();
  const bornes = bornesPourExercice(exercice);
  const { groupId } = await getCliContext();
  const controles = await rapportControles(getDb(), groupId, bornes);
  console.log(formatRapportTexte(controles, bornes));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
