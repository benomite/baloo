'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../../context';
import { applyRemboursementTransition } from '../../services/remboursement-transition';
import { captureClientMeta, deriveAppUrl } from './_helpers';

export async function updateRemboursementStatus(id: string, status: string, formData?: FormData) {
  const motif = formData?.get('motif')?.toString() || undefined;
  const ctx = await getCurrentContext();

  const result = await applyRemboursementTransition(
    {
      groupId: ctx.groupId,
      role: ctx.role,
      userId: ctx.userId,
      email: ctx.email,
      name: ctx.name,
      scopeUniteId: ctx.scopeUniteId,
    },
    id,
    status,
    {
      motif,
      clientMeta: await captureClientMeta(),
      appUrl: await deriveAppUrl(),
    },
  );

  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        redirect('/remboursements?error=' + encodeURIComponent(result.message));
        break;
      default:
        redirect(`/remboursements/${id}?error=` + encodeURIComponent(result.message));
    }
  }

  revalidatePath('/remboursements');
  revalidatePath(`/remboursements/${id}`);
  revalidatePath('/moi');
  revalidatePath('/');
}
