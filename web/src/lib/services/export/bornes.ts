// Bornes temporelles d'un exercice, prêtes à être passées aux requêtes
// d'export. Module pur : aucune I/O, aucune BDD.
import { exerciceBounds } from '../overview';

export interface BornesExercice {
  exercice: string;
  debut: string; // ISO 'YYYY-MM-DD', inclus
  fin: string; // ISO 'YYYY-MM-DD', inclus
  // Les remboursements sont bornés sur COALESCE(date_depense, created_at),
  // et created_at est un timestamp complet : comparer à la date nue
  // exclurait tout ce qui a été créé le dernier jour de l'exercice.
  finInclusiveTs: string;
}

export function bornesPourExercice(exercice: string): BornesExercice {
  const { start, end } = exerciceBounds(exercice);
  return { exercice, debut: start, fin: end, finInclusiveTs: `${end}T23:59:59Z` };
}
