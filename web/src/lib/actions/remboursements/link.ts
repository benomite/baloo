'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../../context';
import { setRembsEcritureLink } from '../../services/remboursement-ecriture-link';
import { logError } from '../../log';

const ADMIN_ROLES = ['tresorier', 'RG'];

// Lie une demande à une écriture comptable. Réservé aux admins.
//
// Signature `(rbtId, formData)` pour usage `<form action={...bind(null, id)}>`,
// le sélecteur d'écriture est un `<select name="ecriture_id">`.
export async function linkRemboursementToEcriture(rbtId: string, formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect(
      `/remboursements/${rbtId}?error=${encodeURIComponent('Action réservée aux trésoriers / RG.')}`,
    );
  }

  const ecritureId = formData.get('ecriture_id')?.toString().trim();
  if (!ecritureId) {
    redirect(
      `/remboursements/${rbtId}?error=${encodeURIComponent('Aucune écriture sélectionnée.')}`,
    );
  }

  const result = await setRembsEcritureLink(ctx.groupId, rbtId, ecritureId);
  if (!result.ok) {
    redirect(`/remboursements/${rbtId}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(`/remboursements/${rbtId}`);
  revalidatePath(`/ecritures/${ecritureId}`);
  if (result.previous) revalidatePath(`/ecritures/${result.previous}`);
  redirect(`/remboursements/${rbtId}?linked=${encodeURIComponent(ecritureId)}`);
}

export async function unlinkRemboursementFromEcriture(rbtId: string): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect(
      `/remboursements/${rbtId}?error=${encodeURIComponent('Action réservée aux trésoriers / RG.')}`,
    );
  }

  try {
    const result = await setRembsEcritureLink(ctx.groupId, rbtId, null);
    if (result.ok && result.previous) {
      revalidatePath(`/ecritures/${result.previous}`);
    }
  } catch (err) {
    logError('remboursements', 'Délier rembs/écriture échoué', err);
  }

  revalidatePath(`/remboursements/${rbtId}`);
  redirect(`/remboursements/${rbtId}?unlinked=1`);
}
