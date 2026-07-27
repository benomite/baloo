'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../../context';
import { setLigneJustificatifs } from '../../services/remboursement-justifs';
import { ADMIN_ROLES } from './_helpers';

// C2 : rattache à UNE ligne de détail la sélection de justifs de la demande
// (cases cochées côté trésorier). Réservé aux admins.
export async function assignLigneJustifs(
  remboursementId: string,
  ligneId: string,
  formData: FormData,
): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    throw new Error('Action réservée au trésorier.');
  }
  const justifIds = formData.getAll('justif_ids').filter((v): v is string => typeof v === 'string');
  await setLigneJustificatifs({ groupId: ctx.groupId }, remboursementId, ligneId, justifIds);
  revalidatePath(`/remboursements/${remboursementId}`);
}
