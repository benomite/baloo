'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  restoreSupprimeeToDraft,
  deleteArbitratedEcriture,
  confirmLink,
  rejectLink,
  type ArbitrageResult,
} from '../services/ecritures-arbitrage';

const REASON_MESSAGES: Record<NonNullable<ArbitrageResult['reason']>, string> = {
  not_found: 'Introuvable.',
  wrong_status: "Cette écriture n'est pas dans l'état attendu.",
  has_attachments: 'Suppression refusée : une pièce (justif, dépôt ou remboursement) est attachée.',
  not_pending: 'Cette suggestion a déjà été traitée.',
};

function toResponse(res: ArbitrageResult): { ok: boolean; message?: string } {
  if (res.ok) return { ok: true };
  return { ok: false, message: res.reason ? REASON_MESSAGES[res.reason] : 'Action impossible.' };
}

export async function restaurerEnDraft(id: string) {
  const { groupId } = await getCurrentContext();
  const res = await restoreSupprimeeToDraft(groupId, id);
  if (res.ok) revalidatePath('/ecritures');
  return toResponse(res);
}

export async function supprimerDefinitivement(id: string) {
  const { groupId } = await getCurrentContext();
  const res = await deleteArbitratedEcriture(groupId, id);
  if (res.ok) revalidatePath('/ecritures');
  return toResponse(res);
}

export async function confirmerLien(suggestionId: string) {
  const { groupId } = await getCurrentContext();
  const res = await confirmLink(groupId, suggestionId);
  if (res.ok) revalidatePath('/ecritures');
  return toResponse(res);
}

export async function rejeterLien(suggestionId: string) {
  const { groupId } = await getCurrentContext();
  const res = await rejectLink(groupId, suggestionId);
  if (res.ok) revalidatePath('/ecritures');
  return toResponse(res);
}
