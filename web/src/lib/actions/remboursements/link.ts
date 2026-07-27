'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../../context';
import { setRembsEcritureLink } from '../../services/remboursement-ecriture-link';
import { updateRemboursement } from '../../services/remboursements';
import { applyRemboursementTransition } from '../../services/remboursement-transition';
import { getRemboursement } from '../../queries/remboursements';
import { logError } from '../../log';
import { canLinkEcriture } from './link-guard';
import { captureClientMeta, deriveAppUrl } from './_helpers';

const ADMIN_ROLES = ['tresorier', 'RG'];

// Lie une demande à une écriture comptable. Réservé aux admins.
//
// Signature `(rbtId, formData)` pour usage `<form action={...bind(null, id)}>`,
// le sélecteur d'écriture (Combobox recherchable) poste `ecriture_id`.
//
// A3 : l'écriture comptable du virement n'existe qu'une fois le virement
// effectué → garde de statut avant de poser le lien.
// A4 : poser le lien matérialise le virement rapproché → tentative
// (best-effort) de passage en `termine` juste après.
export async function linkRemboursementToEcriture(rbtId: string, formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect(
      `/remboursements/${rbtId}?error=${encodeURIComponent('Action réservée aux trésoriers / RG.')}`,
    );
  }

  const rbt = await getRemboursement(rbtId);
  if (!rbt || !canLinkEcriture(rbt.status)) {
    redirect(
      `/remboursements/${rbtId}?error=${encodeURIComponent(
        "L'écriture comptable n'existe qu'une fois le virement effectué.",
      )}`,
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

  // A4 : le lien matérialise le virement rapproché → passage en terminé auto.
  // Best-effort : si la transition échoue (retour `{ok:false}` OU exception),
  // le lien reste posé et l'utilisateur suit le chemin de succès normal.
  try {
    const transition = await applyRemboursementTransition(
      {
        groupId: ctx.groupId,
        role: ctx.role,
        userId: ctx.userId,
        email: ctx.email,
        name: ctx.name,
        scopeUniteIds: ctx.scopeUniteIds,
      },
      rbtId,
      'termine',
      { clientMeta: await captureClientMeta(), appUrl: await deriveAppUrl() },
    );
    if (!transition.ok) {
      logError('remboursements', 'Lien posé mais passage en terminé échoué', new Error(transition.message));
    }
  } catch (err) {
    logError('remboursements', 'Lien posé mais passage en terminé échoué (exception)', err);
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

  const rbt = await getRemboursement(rbtId);
  try {
    const result = await setRembsEcritureLink(ctx.groupId, rbtId, null);
    if (result.ok && result.previous) {
      revalidatePath(`/ecritures/${result.previous}`);
    }
    // Le passage en terminé venait du lien (A4) → le délier l'annule. Écriture
    // directe du statut (pas de transition régressive `termine → virement_effectue`).
    if (rbt && rbt.status === 'termine') {
      await updateRemboursement(
        { groupId: ctx.groupId, scopeUniteIds: ctx.scopeUniteIds },
        rbtId,
        { status: 'virement_effectue' },
      );
    }
  } catch (err) {
    logError('remboursements', 'Délier rembs/écriture échoué', err);
  }

  revalidatePath(`/remboursements/${rbtId}`);
  redirect(`/remboursements/${rbtId}?unlinked=1`);
}
