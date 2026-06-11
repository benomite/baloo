'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { createCamp as createCampService, updateCampStatut as updateCampStatutService, CAMP_STATUTS, type CampStatut } from '../services/camps';
import { parseAmount } from '../format';
import {
  createAvance,
  cloturerAvance,
  rouvrirAvance,
  AVANCE_MODES,
  type AvanceMode,
} from '../services/camp-avances';

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

export async function createAvanceCamp(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  const campId = (formData.get('camp_id') as string | null) ?? '';
  if (!isAdmin(ctx.role)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const beneficiaire = (formData.get('beneficiaire') as string | null)?.trim() ?? '';
  const montantRaw = (formData.get('montant') as string | null)?.trim() ?? '';
  const mode = (formData.get('mode') as string | null) ?? '';
  if (!campId || !beneficiaire || !montantRaw || !(AVANCE_MODES as readonly string[]).includes(mode)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Bénéficiaire, montant et mode requis.'));
  }
  const montant_cents = parseAmount(montantRaw);
  if (!Number.isInteger(montant_cents)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Montant illisible (format attendu : 150,00).'));
  }
  const res = await createAvance(
    { groupId: ctx.groupId },
    {
      camp_id: campId,
      beneficiaire,
      montant_cents: montant_cents,
      date_versement: (formData.get('date_versement') as string | null) || null,
      mode: mode as AvanceMode,
      ecriture_id: (formData.get('ecriture_id') as string | null) || null,
      notes: (formData.get('notes') as string | null) || null,
    },
  );
  if (!res.ok) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent(res.error ?? 'Création refusée.'));
  }
  revalidatePath(`/camps/${campId}`);
  redirect(`/camps/${campId}`);
}

export async function cloturerAvanceCamp(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  const campId = (formData.get('camp_id') as string | null) ?? '';
  if (!isAdmin(ctx.role)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const id = (formData.get('id') as string | null) ?? '';
  const renduRaw = (formData.get('montant_rendu') as string | null)?.trim() ?? '';
  const rendu_cents = parseAmount(renduRaw === '' ? '0' : renduRaw);
  if (!Number.isInteger(rendu_cents)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Montant rendu illisible (format attendu : 12,50).'));
  }
  const res = await cloturerAvance({ groupId: ctx.groupId }, id, rendu_cents);
  if (!res.ok) {
    redirect(`/camps/${res.campId ?? campId}?error=` + encodeURIComponent(res.error ?? 'Clôture refusée.'));
  }
  revalidatePath(`/camps/${campId}`);
  redirect(`/camps/${campId}`);
}

export async function rouvrirAvanceCamp(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  const campId = (formData.get('camp_id') as string | null) ?? '';
  if (!isAdmin(ctx.role)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const id = (formData.get('id') as string | null) ?? '';
  const res = await rouvrirAvance({ groupId: ctx.groupId }, id);
  if (!res.ok) {
    redirect(`/camps/${res.campId ?? campId}?error=` + encodeURIComponent(res.error ?? 'Réouverture refusée.'));
  }
  revalidatePath(`/camps/${campId}`);
  redirect(`/camps/${campId}`);
}
