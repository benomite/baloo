'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { createCamp as createCampService, updateCampStatut as updateCampStatutService, CAMP_STATUTS, type CampStatut } from '../services/camps';

const ADMIN_ROLES = ['tresorier', 'RG'] as const;
const isAdmin = (r: string) => (ADMIN_ROLES as readonly string[]).includes(r);

export async function createCamp(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdmin(ctx.role)) redirect('/camps?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  const name = (formData.get('name') as string | null)?.trim() ?? '';
  const unite_id = formData.get('unite_id') as string | null;
  const activite_id = formData.get('activite_id') as string | null;
  if (!name || !unite_id || !activite_id) {
    redirect('/camps?error=' + encodeURIComponent('Nom, unité et activité Comptaweb requis.'));
  }
  let id: string;
  try {
    const camp = await createCampService({ groupId: ctx.groupId }, {
      name, unite_id: unite_id!, activite_id: activite_id!,
      date_debut: (formData.get('date_debut') as string | null) || null,
      date_fin: (formData.get('date_fin') as string | null) || null,
      notes: (formData.get('notes') as string | null) || null,
    });
    id = camp.id;
  } catch (err) {
    redirect('/camps?error=' + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }
  revalidatePath('/camps');
  redirect(`/camps/${id!}`);
}

export async function setCampStatut(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdmin(ctx.role)) redirect('/camps?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  const id = formData.get('id') as string | null;
  const statut = formData.get('statut') as string | null;
  if (!id || !statut || !(CAMP_STATUTS as readonly string[]).includes(statut)) {
    redirect('/camps?error=' + encodeURIComponent('Statut invalide.'));
  }
  const res = await updateCampStatutService({ groupId: ctx.groupId }, id!, statut as CampStatut);
  if (!res.ok) redirect(`/camps/${id}?error=` + encodeURIComponent(res.error ?? 'Mise à jour refusée.'));
  revalidatePath('/camps');
  revalidatePath(`/camps/${id}`);
  redirect(`/camps/${id}`);
}
