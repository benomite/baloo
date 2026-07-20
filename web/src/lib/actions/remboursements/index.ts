// Barrel : ré-exporte les server actions du domaine remboursement.
// Les imports `@/lib/actions/remboursements` continuent de marcher.
//
// Le code est découpé par responsabilité :
//   - create.ts  : création (formulaire unifié)
//   - update.ts  : édition (full + patch limité notes/RIB)
//   - status.ts  : transitions de statut (validation, refus, virement, termine)
//   - _helpers.ts : utilitaires partagés (parsing FormData, IP, admins)

export { createRemboursement } from './create';

export { updateMyRemboursement, patchNotesAndRib } from './update';

export { updateRemboursementStatus } from './status';

export { linkRemboursementToEcriture, unlinkRemboursementFromEcriture } from './link';

export { assignJustifToLignes } from './assign-justif';
