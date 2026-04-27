'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../context';
import {
  createRemboursement as createRemboursementService,
  updateRemboursement as updateRemboursementService,
} from '../services/remboursements';
import { parseAmount } from '../format';

export async function createRemboursement(formData: FormData) {
  const { groupId } = await getCurrentContext();
  const created = createRemboursementService(
    { groupId },
    {
      demandeur: formData.get('demandeur') as string,
      amount_cents: parseAmount(formData.get('montant') as string),
      date_depense: formData.get('date_depense') as string,
      nature: formData.get('nature') as string,
      unite_id: (formData.get('unite_id') as string) || null,
      justificatif_status: ((formData.get('justificatif_status') as string) || 'en_attente') as
        | 'oui'
        | 'en_attente'
        | 'non',
      mode_paiement_id: (formData.get('mode_paiement_id') as string) || null,
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/remboursements');
  revalidatePath('/');
  redirect(`/remboursements/${created.id}`);
}

export async function updateRemboursementStatus(id: string, status: string) {
  const { groupId } = await getCurrentContext();
  const today = new Date().toISOString().split('T')[0];
  updateRemboursementService(
    { groupId },
    id,
    {
      status: status as 'demande' | 'valide' | 'paye' | 'refuse',
      ...(status === 'paye' ? { date_paiement: today } : {}),
    },
  );

  revalidatePath('/remboursements');
  revalidatePath(`/remboursements/${id}`);
  revalidatePath('/');
}
