'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  createMouvementCaisse as createMouvementCaisseService,
  createDepotEspecesAvecMouvement,
} from '../services/caisse';
import { attachDepotEspecesToEcriture } from '../services/depots-especes';
import {
  syncCaisseFromComptaweb,
  discoverCaisses,
} from '../services/caisse-sync';
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
      type: sens === 'entree' ? 'entree' : 'sortie',
      unite_id: (formData.get('unite_id') as string) || null,
      activite_id: (formData.get('activite_id') as string) || null,
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/caisse');
  revalidatePath('/');
}

export async function createDepotEspecesAction(formData: FormData) {
  const ctx = await getCurrentContext();

  const total = parseAmount(formData.get('montant') as string);
  if (total <= 0) {
    throw new Error('Le montant du dépôt doit être strictement positif.');
  }

  await createDepotEspecesAvecMouvement(
    { groupId: ctx.groupId },
    {
      date_depot: formData.get('date_depot') as string,
      total_amount_cents: total,
      description: (formData.get('description') as string) || null,
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/caisse');
  revalidatePath('/');
}

export async function rapprocherDepotEspecesAction(formData: FormData) {
  const ctx = await getCurrentContext();
  const depotId = formData.get('depot_id') as string;
  const ecritureId = formData.get('ecriture_id') as string;
  if (!depotId || !ecritureId) {
    throw new Error('Dépôt et écriture banque requis.');
  }
  await attachDepotEspecesToEcriture({ groupId: ctx.groupId }, depotId, ecritureId);
  revalidatePath('/caisse');
  revalidatePath('/');
}

export async function syncCaisseFromComptawebAction(formData: FormData) {
  const ctx = await getCurrentContext();
  let caisseId = Number(formData.get('caisse_id'));
  if (!caisseId || Number.isNaN(caisseId)) {
    const list = await discoverCaisses();
    const active = list.find((c) => !c.inactif);
    if (!active) throw new Error('Aucune caisse active trouvée côté Comptaweb.');
    caisseId = active.id;
  }
  await syncCaisseFromComptaweb(ctx.groupId, caisseId);
  revalidatePath('/caisse');
  revalidatePath('/');
}
