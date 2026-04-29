'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { createMouvementCaisse as createMouvementCaisseService } from '../services/caisse';
import { parseAmount } from '../format';

export async function createMouvementCaisse(formData: FormData) {
  const ctx = await getCurrentContext();

  // Sens explicite : "entree" (positif) ou "sortie" (négatif). Plus
  // robuste que de demander à saisir +/- dans le montant.
  const sens = (formData.get('sens') as string | null) ?? 'sortie';
  const amount = parseAmount(formData.get('montant') as string);
  const signed = sens === 'entree' ? Math.abs(amount) : -Math.abs(amount);

  await createMouvementCaisseService(
    { groupId: ctx.groupId },
    {
      date_mouvement: formData.get('date_mouvement') as string,
      description: formData.get('description') as string,
      amount_cents: signed,
      unite_id: (formData.get('unite_id') as string) || null,
      activite_id: (formData.get('activite_id') as string) || null,
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/caisse');
  revalidatePath('/');
}
