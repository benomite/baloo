// Barrel : ré-exporte les server actions du domaine remboursement.
// Les imports `@/lib/actions/remboursements` continuent de marcher.
//
// Le code est découpé par responsabilité :
//   - create.ts  : création (legacy + self-service + saisie pour autrui)
//   - update.ts  : édition (full + patch limité notes/RIB)
//   - status.ts  : transitions de statut (validation, refus, virement, termine)
//   - _helpers.ts : utilitaires partagés (parsing FormData, IP, admins)

export {
  createRemboursement,
  createMyRemboursement,
  createForeignRemboursement,
} from './create';

export { updateMyRemboursement, patchNotesAndRib } from './update';

export { updateRemboursementStatus } from './status';
