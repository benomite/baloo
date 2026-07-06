// services/remboursement-transition.ts
// PAS de 'use server' — cf. AGENTS.md §'use server' ≠ helpers serveur

import { getDb } from '../db';
import { getRemboursement, updateRemboursement } from './remboursements';
import { getRembsTransitionGuard } from './remboursements-transitions';
import { signAndRefreshRemboursementPdf } from './remboursement-signing';
import { sendRemboursementStatusChangedEmail } from '../email/remboursement';
import { logError } from '../log';
import type { RemboursementStatus } from '../types';

export interface TransitionCtx {
  groupId: string;
  role: string;
  userId: string;
  /** Email de l'acteur. Utilisé pour la signature électronique et la notif. */
  email: string;
  /** Nom d'affichage de l'acteur (peut être null pour un token MCP). */
  name: string | null;
  scopeUniteIds: string[];
}

export type TransitionResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'unknown_status' | 'wrong_role' | 'wrong_source' | 'not_found' | 'needs_ecriture';
      message: string;
    };

export interface TransitionOpts {
  motif?: string;
  clientMeta?: { ip?: string | null; userAgent?: string | null };
  appUrl?: string;
}

const NOTIFY_STATUSES = new Set([
  'valide_tresorier',
  'valide_rg',
  'virement_effectue',
  'termine',
  'refuse',
]);

/**
 * Applique une transition de statut sur un remboursement avec TOUTE la logique
 * métier : validation de transition, garde `termine` sans écriture, mise à jour
 * BDD (statut + date_paiement si virement + motif_refus si refus), signature
 * électronique (valide_tresorier / valide_rg), notification email au soumetteur
 * (si différent de l'acteur).
 *
 * Les effets de bord (signature, email) sont best-effort : toute erreur est
 * loguée mais NE bloque PAS la transition.
 *
 * NE fait PAS de redirect() ni revalidatePath() — c'est la responsabilité
 * de l'appelant (server action UI ou tool MCP).
 */
export async function applyRemboursementTransition(
  ctx: TransitionCtx,
  id: string,
  targetStatus: string,
  opts: TransitionOpts = {},
): Promise<TransitionResult> {
  // 1. Guard de transition (module pur)
  const guard = getRembsTransitionGuard(targetStatus);
  if (!guard) {
    return { ok: false, reason: 'unknown_status', message: `Statut inconnu : ${targetStatus}.` };
  }
  if (!guard.allowedRoles.includes(ctx.role)) {
    return {
      ok: false,
      reason: 'wrong_role',
      message: `Action réservée aux rôles : ${guard.allowedRoles.join(' / ')}.`,
    };
  }

  // 2. Récupération du remboursement
  const rbt = await getRemboursement({ groupId: ctx.groupId }, id);
  if (!rbt) {
    return { ok: false, reason: 'not_found', message: 'Demande introuvable.' };
  }

  // 3. Validation de la source
  if (!guard.from.includes(rbt.status)) {
    return {
      ok: false,
      reason: 'wrong_source',
      message: `Transition impossible depuis le statut « ${rbt.status} ».`,
    };
  }

  // 4. Garde métier `→ termine` : écriture liée obligatoire
  if (targetStatus === 'termine' && !rbt.ecriture_id) {
    return {
      ok: false,
      reason: 'needs_ecriture',
      message:
        "Lie d'abord la demande à l'écriture comptable du virement (sidebar admin), puis marque-la terminée.",
    };
  }

  // 5. Mise à jour BDD
  const today = new Date().toISOString().split('T')[0];
  await updateRemboursement(
    { groupId: ctx.groupId, scopeUniteIds: ctx.scopeUniteIds },
    id,
    {
      status: targetStatus as RemboursementStatus,
      ...(targetStatus === 'virement_effectue' ? { date_paiement: today } : {}),
      ...(targetStatus === 'refuse' && opts.motif ? { motif_refus: opts.motif } : {}),
    },
  );

  // 6. Signature électronique (best-effort — ne bloque pas la transition)
  if (targetStatus === 'valide_tresorier' || targetStatus === 'valide_rg') {
    try {
      await signAndRefreshRemboursementPdf({
        groupId: ctx.groupId,
        rbtId: id,
        signerRole: targetStatus === 'valide_tresorier' ? 'tresorier' : 'RG',
        signerUserId: ctx.userId,
        signerEmail: ctx.email,
        signerName: ctx.name,
        ip: opts.clientMeta?.ip ?? null,
        userAgent: opts.clientMeta?.userAgent ?? null,
      });
    } catch (err) {
      logError('remboursements', 'Signature validation échouée', err);
    }
  }

  // 7. Notification email au soumetteur (best-effort)
  if (NOTIFY_STATUSES.has(targetStatus)) {
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
            amountCents: rbt.total_cents ?? rbt.amount_cents,
            newStatus: targetStatus as 'valide_tresorier' | 'valide_rg' | 'virement_effectue' | 'termine' | 'refuse',
            motif: opts.motif ?? rbt.motif_refus,
            appUrl: opts.appUrl ?? 'https://localhost',
          });
        }
      }
    } catch (err) {
      logError('remboursements', 'Notif demandeur échouée', err);
    }
  }

  return { ok: true };
}
