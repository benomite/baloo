'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { createMouvementCaisse as createMouvementCaisseService } from '../services/caisse';
import { parseAmount } from '../format';

export async function createMouvementCaisse(formData: FormData) {
  createMouvementCaisseService(
    { groupId: getCurrentContext().groupId },
    {
      date_mouvement: formData.get('date_mouvement') as string,
      description: formData.get('description') as string,
      amount_cents: parseAmount(formData.get('montant') as string),
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/caisse');
  revalidatePath('/');
}
