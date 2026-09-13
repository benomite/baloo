'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { requireAdmin } from '../auth/access';
import { updateGroupe } from '../services/groupes';
import { logError } from '../log';

// Met à jour le taux kilométrique du groupe (millièmes d'euro). Saisie en
// euros (« 0,354 ») → millièmes (354). Réservé aux admins.
export async function updateTauxKm(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const raw = ((formData.get('taux_km') as string | null) ?? '').trim().replace(',', '.');
  const euros = Number(raw);
  if (!raw || !isFinite(euros) || euros <= 0) {
    redirect('/admin/parametres?error=' + encodeURIComponent('Taux invalide.'));
  }
  const millicents = Math.round(euros * 1000);

  try {
    await updateGroupe({ groupId: ctx.groupId }, { taux_km_millicents: millicents });
  } catch (err) {
    logError('parametres', 'MAJ taux km échouée', err);
    redirect('/admin/parametres?error=' + encodeURIComponent('Échec de l’enregistrement.'));
  }
  revalidatePath('/admin/parametres');
  redirect('/admin/parametres?saved=1');
}

// Déclare (ou rouvre) la clôture d'un exercice. Format attendu : '2025-2026'.
// Vider le champ rouvre l'exercice — la déclaration est réversible.
export async function updateExerciceClos(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const raw = ((formData.get('dernier_exercice_clos') as string | null) ?? '').trim();
  if (raw && !/^\d{4}-\d{4}$/.test(raw)) {
    redirect('/admin/parametres?error=' + encodeURIComponent('Format attendu : 2025-2026.'));
  }

  try {
    await updateGroupe({ groupId: ctx.groupId }, { dernier_exercice_clos: raw || null });
  } catch (err) {
    logError('parametres', 'MAJ exercice clos échouée', err);
    redirect('/admin/parametres?error=' + encodeURIComponent('Échec de l’enregistrement.'));
  }
  revalidatePath('/admin/parametres');
  redirect('/admin/parametres?saved=1');
}
