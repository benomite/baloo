'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../../context';
import { getRemboursement } from '../../queries/remboursements';
import { convertRemboursementToDepot } from '../../services/remboursement-convert';
import { canConvertRemboursement } from './convert-guard';

// Convertit une demande de remboursement soumise par erreur en dépôt/justif
// (cf. remboursement-convert.ts). Trésorier seul, avant toute validation
// (statut a_traiter) — cf. convert-guard.ts (A2).
export async function convertRembToDepot(id: string): Promise<void> {
  const ctx = await getCurrentContext();
  const rbt = await getRemboursement(id);
  if (!rbt || !canConvertRemboursement(ctx.role, rbt.status)) {
    redirect('/remboursements/' + id + '?error=' + encodeURIComponent(
      'Conversion possible seulement par le trésorier, sur une demande non validée.'));
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
