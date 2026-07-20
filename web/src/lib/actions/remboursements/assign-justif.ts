'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../../context';
import { setJustificatifLignes } from '../../services/remboursement-justifs';
import { ADMIN_ROLES } from './_helpers';

// Affecte un justif de la demande à une sélection de lignes de détail
// (cases à cochées côté trésorier). `ligne_ids` = les lignes couvertes ;
// absence de sélection = on retire toutes les affectations du justif.
// Réservé aux admins (trésorier / RG).
export async function assignJustifToLignes(
  remboursementId: string,
  justificatifId: string,
  formData: FormData,
): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    throw new Error('Action réservée au trésorier.');
  }
  const ligneIds = formData
    .getAll('ligne_ids')
    .filter((v): v is string => typeof v === 'string');
  await setJustificatifLignes({ groupId: ctx.groupId }, remboursementId, justificatifId, ligneIds);
  revalidatePath(`/remboursements/${remboursementId}`);
}
