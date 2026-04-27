'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../context';
import {
  createEcriture as createEcritureService,
  updateEcriture as updateEcritureService,
  updateEcritureStatus as updateEcritureStatusService,
  updateEcritureField as updateEcritureFieldService,
  batchUpdateEcritures as batchUpdateEcrituresService,
  type InlineField,
  type BatchPatch,
  type BatchResult,
} from '../services/ecritures';
import { parseAmount } from '../format';

export async function createEcriture(formData: FormData) {
  const { groupId, scopeUniteId } = await getCurrentContext();
  const created = createEcritureService(
    { groupId, scopeUniteId },
    {
      date_ecriture: formData.get('date_ecriture') as string,
      description: formData.get('description') as string,
      amount_cents: parseAmount(formData.get('montant') as string),
      type: formData.get('type') as 'depense' | 'recette',
      unite_id: (formData.get('unite_id') as string) || null,
      category_id: (formData.get('category_id') as string) || null,
      mode_paiement_id: (formData.get('mode_paiement_id') as string) || null,
      activite_id: (formData.get('activite_id') as string) || null,
      numero_piece: (formData.get('numero_piece') as string) || null,
      carte_id: (formData.get('carte_id') as string) || null,
      justif_attendu: formData.has('justif_attendu') ? 1 : 0,
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/ecritures');
  revalidatePath('/');
  redirect(`/ecritures/${created.id}`);
}

export async function updateEcriture(id: string, formData: FormData) {
  const { groupId, scopeUniteId } = await getCurrentContext();
  updateEcritureService(
    { groupId, scopeUniteId },
    id,
    {
      date_ecriture: formData.get('date_ecriture') as string,
      description: formData.get('description') as string,
      amount_cents: parseAmount(formData.get('montant') as string),
      type: formData.get('type') as 'depense' | 'recette',
      unite_id: (formData.get('unite_id') as string) || null,
      category_id: (formData.get('category_id') as string) || null,
      mode_paiement_id: (formData.get('mode_paiement_id') as string) || null,
      activite_id: (formData.get('activite_id') as string) || null,
      numero_piece: (formData.get('numero_piece') as string) || null,
      carte_id: (formData.get('carte_id') as string) || null,
      justif_attendu: formData.has('justif_attendu') ? 1 : 0,
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  revalidatePath('/');
  redirect(`/ecritures/${id}`);
}

export async function updateEcritureStatus(id: string, status: string) {
  const { groupId, scopeUniteId } = await getCurrentContext();
  updateEcritureStatusService(
    { groupId, scopeUniteId },
    id,
    status as 'brouillon' | 'valide' | 'saisie_comptaweb',
  );

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  revalidatePath('/');
}

// Mise à jour d'un champ unique — utilisé pour l'édition inline depuis la
// table /ecritures (clic sur une cellule → select → save immédiat). Refuse
// sur les écritures déjà synchronisées Comptaweb pour les champs sync.
export async function updateEcritureField(
  id: string,
  field: InlineField,
  value: string | number | null,
): Promise<{ ok: boolean; message?: string }> {
  const { groupId, scopeUniteId } = await getCurrentContext();
  const result = updateEcritureFieldService({ groupId, scopeUniteId }, id, field, value);
  if (!result.ok) {
    if (result.reason === 'not_found') return { ok: false, message: `Écriture ${id} introuvable.` };
    if (result.reason === 'sync_locked') return { ok: false, message: 'Écriture synchronisée Comptaweb — champ non modifiable.' };
    return { ok: false, message: `Champ ${field} non autorisé.` };
  }
  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  return { ok: true };
}

export async function batchUpdateEcritures(ids: string[], patch: BatchPatch): Promise<BatchResult> {
  const { groupId, scopeUniteId } = await getCurrentContext();
  const result = batchUpdateEcrituresService({ groupId, scopeUniteId }, ids, patch);
  if (result.updated > 0) revalidatePath('/ecritures');
  return result;
}
