// PAS de 'use server' — service pur partagé entre server actions et tools MCP.
// Cf. AGENTS.md §'use server' ≠ helpers serveur.

import { getAbandon, isAllowedAbandonTransition, updateAbandon, type AbandonStatus } from './abandons';

const ADMIN_ROLES = ['tresorier', 'RG'];

export interface AbandonTransitionCtx {
  groupId: string;
  role: string;
  userId: string;
}

export type AbandonTransitionResult =
  | { ok: true }
  | { ok: false; reason: 'wrong_role' | 'not_found' | 'wrong_source'; message: string };

export interface AbandonTransitionOpts {
  motif?: string;
  sentToNationalAt?: string | null;
}

/**
 * Applique une transition de statut sur un abandon avec validation métier.
 * Pas de signature électronique, pas de notification email (non implémenté
 * dans les actions actuelles pour les transitions admin).
 *
 * NE fait PAS de redirect() ni revalidatePath().
 */
export async function applyAbandonTransition(
  ctx: AbandonTransitionCtx,
  id: string,
  targetStatus: AbandonStatus,
  opts: AbandonTransitionOpts = {},
): Promise<AbandonTransitionResult> {
  // 1. Vérification du rôle
  if (!ADMIN_ROLES.includes(ctx.role)) {
    return {
      ok: false,
      reason: 'wrong_role',
      message: 'Action réservée aux trésoriers / RG.',
    };
  }

  // 2. Récupération de l'abandon
  const current = await getAbandon({ groupId: ctx.groupId }, id);
  if (!current) {
    return { ok: false, reason: 'not_found', message: 'Abandon introuvable.' };
  }

  // 3. Validation de la transition
  if (!isAllowedAbandonTransition(current.status, targetStatus)) {
    return {
      ok: false,
      reason: 'wrong_source',
      message: `Transition non autorisée : ${current.status} → ${targetStatus}.`,
    };
  }

  // 4. Construction du patch selon le statut cible
  const patch: Parameters<typeof updateAbandon>[2] = { status: targetStatus };
  if (targetStatus === 'refuse' && opts.motif !== undefined) {
    patch.motif_refus = opts.motif;
  }
  if (targetStatus === 'envoye_national' && opts.sentToNationalAt !== undefined) {
    patch.sent_to_national_at = opts.sentToNationalAt;
  }

  // 5. Mise à jour BDD
  await updateAbandon({ groupId: ctx.groupId }, id, patch);

  return { ok: true };
}
