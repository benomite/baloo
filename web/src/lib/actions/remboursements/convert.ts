'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../../context';
import { ADMIN_ROLES } from '../../auth/access';
import { convertRemboursementToDepot } from '../../services/remboursement-convert';

// Convertit une demande de remboursement soumise par erreur en dépôt/justif
// (cf. remboursement-convert.ts). Admin only. Redirige avec un message.
export async function convertRembToDepot(id: string): Promise<void> {
  const ctx = await getCurrentContext();
  if (!(ADMIN_ROLES as readonly string[]).includes(ctx.role)) {
    redirect('/remboursements?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  try {
    const res = await convertRemboursementToDepot({ groupId: ctx.groupId }, id);
    revalidatePath('/remboursements');
    revalidatePath(`/remboursements/${id}`);
    revalidatePath('/ecritures');
    revalidatePath('/depots');
    const dest = res.targetEcritureId
      ? `/ecritures?open=${encodeURIComponent(res.targetEcritureId)}&converted=1`
      : '/depots?converted=1';
    redirect(dest);
  } catch (err) {
    // NEXT_REDIRECT n'est pas une vraie erreur : on le laisse se propager.
    if (err && typeof err === 'object' && 'digest' in err && String((err as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw err;
    }
    redirect(`/remboursements/${id}?error=` + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }
}
