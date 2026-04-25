'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../context';
import {
  createEcriture as createEcritureService,
  updateEcriture as updateEcritureService,
  updateEcritureStatus as updateEcritureStatusService,
} from '../services/ecritures';
import { parseAmount } from '../format';

export async function createEcriture(formData: FormData) {
  const { groupId } = getCurrentContext();
  const created = createEcritureService(
    { groupId },
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
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/ecritures');
  revalidatePath('/');
  redirect(`/ecritures/${created.id}`);
}

export async function updateEcriture(id: string, formData: FormData) {
  const { groupId } = getCurrentContext();
  updateEcritureService(
    { groupId },
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
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  revalidatePath('/');
  redirect(`/ecritures/${id}`);
}

export async function updateEcritureStatus(id: string, status: string) {
  const { groupId } = getCurrentContext();
  updateEcritureStatusService(
    { groupId },
    id,
    status as 'brouillon' | 'valide' | 'saisie_comptaweb',
  );

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  revalidatePath('/');
}
