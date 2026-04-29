'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../../context';
import { getDb } from '../../db';
import {
  getRemboursement,
  updateRemboursement as updateRemboursementService,
} from '../../services/remboursements';
import { sendRemboursementStatusChangedEmail } from '../../email/remboursement';
import { signAndRefreshRemboursementPdf } from '../../services/remboursement-signing';
import { captureClientMeta, deriveAppUrl } from './_helpers';

// Garde de transitions : qui peut faire quoi sur la timeline 5 statuts.
const TRANSITIONS: Record<string, { from: string[]; allowedRoles: string[] }> = {
  valide_tresorier: { from: ['a_traiter'], allowedRoles: ['tresorier'] },
  valide_rg: { from: ['valide_tresorier'], allowedRoles: ['RG'] },
  virement_effectue: { from: ['valide_rg'], allowedRoles: ['tresorier', 'RG'] },
  termine: { from: ['virement_effectue'], allowedRoles: ['tresorier', 'RG'] },
  refuse: {
    from: ['a_traiter', 'valide_tresorier', 'valide_rg', 'virement_effectue'],
    allowedRoles: ['tresorier', 'RG'],
  },
};

// Note signature : `formData` en dernier argument permet de l'utiliser
// comme `<form action={updateRemboursementStatus.bind(null, id, status)}>`,
// le form fournit FormData et on en extrait le motif si présent.
export async function updateRemboursementStatus(id: string, status: string, formData?: FormData) {
  const motif = formData?.get('motif')?.toString() || undefined;
  const ctx = await getCurrentContext();

  const transition = TRANSITIONS[status];
  if (!transition) {
    redirect(`/remboursements/${id}?error=` + encodeURIComponent(`Statut inconnu : ${status}.`));
  }
  if (!transition.allowedRoles.includes(ctx.role)) {
    redirect(`/remboursements/${id}?error=` + encodeURIComponent(`Action réservée aux rôles : ${transition.allowedRoles.join(' / ')}.`));
  }

  const rbt = await getRemboursement({ groupId: ctx.groupId }, id);
  if (!rbt) {
    redirect('/remboursements?error=' + encodeURIComponent('Demande introuvable.'));
  }
  if (!transition.from.includes(rbt.status)) {
    redirect(`/remboursements/${id}?error=` + encodeURIComponent(`Transition impossible depuis le statut « ${rbt.status} ».`));
  }

  const today = new Date().toISOString().split('T')[0];
  await updateRemboursementService(
    { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId },
    id,
    {
      status: status as 'a_traiter' | 'valide_tresorier' | 'valide_rg' | 'virement_effectue' | 'termine' | 'refuse',
      ...(status === 'virement_effectue' ? { date_paiement: today } : {}),
      ...(status === 'refuse' && motif ? { motif_refus: motif } : {}),
    },
  );

  // Signature électronique pour les transitions de validation. La
  // signature embarque l'identité du valideur + un hash des données
  // courantes ; la chaîne d'audit garantit l'ordre et l'intégrité.
  if (status === 'valide_tresorier' || status === 'valide_rg') {
    try {
      const meta = await captureClientMeta();
      await signAndRefreshRemboursementPdf({
        groupId: ctx.groupId,
        rbtId: id,
        signerRole: status === 'valide_tresorier' ? 'tresorier' : 'RG',
        signerUserId: ctx.userId,
        signerEmail: ctx.email,
        signerName: ctx.name,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    } catch (err) {
      console.error('[remboursements] Signature validation échouée :', err);
    }
  }

  if (status === 'valide_tresorier' || status === 'valide_rg' || status === 'virement_effectue' || status === 'termine' || status === 'refuse') {
    try {
      if (rbt.submitted_by_user_id && rbt.submitted_by_user_id !== ctx.userId) {
        const submitter = await getDb()
          .prepare('SELECT email, nom_affichage FROM users WHERE id = ?')
          .get<{ email: string; nom_affichage: string | null }>(rbt.submitted_by_user_id);
        if (submitter?.email) {
          await sendRemboursementStatusChangedEmail({
            to: submitter.email,
            invitedName: submitter.nom_affichage,
            rbtId: rbt.id,
            natureDescription: rbt.nature ?? '',
            amountCents: rbt.total_cents || rbt.amount_cents,
            newStatus: status,
            motif: motif ?? rbt.motif_refus,
            appUrl: await deriveAppUrl(),
          });
        }
      }
    } catch (err) {
      console.error('[remboursements] Notif demandeur échouée :', err);
    }
  }

  revalidatePath('/remboursements');
  revalidatePath(`/remboursements/${id}`);
  revalidatePath('/moi');
  revalidatePath('/');
}
