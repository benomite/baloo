'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  attachDepotToEcriture as attachDepotToEcritureService,
  rejectDepot as rejectDepotService,
} from '../services/depots';
import { updateEcriture } from '../services/ecritures';

const ADMIN_ROLES = ['tresorier', 'RG'] as const;
function isAdminRole(role: string): role is (typeof ADMIN_ROLES)[number] {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

// Préserve les query params (period, recettes) au retour pour ne pas
// reset le filtre choisi.
function buildInboxRedirect(
  formData: FormData,
  extra: Record<string, string>,
): string {
  const sp = new URLSearchParams();
  const period = (formData.get('return_period') as string | null) ?? null;
  const recettes = (formData.get('return_recettes') as string | null) ?? null;
  if (period && period !== '90j') sp.set('period', period);
  if (recettes === '1') sp.set('recettes', '1');
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `/inbox?${qs}` : '/inbox';
}

// Lie un dépôt orphelin à une écriture orpheline. Aucune validation
// temporelle ou de montant : un matching à 5 mois d'écart reste valide
// (cas réel : remboursement de décembre payé en mai). La modale de
// confirmation côté UI gère le garde-fou ergonomique.
export async function lierEcritureJustif(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect(buildInboxRedirect(formData, { error: 'Action réservée aux trésoriers / RG.' }));
  }
  const ecritureId = formData.get('ecriture_id') as string | null;
  const depotId = formData.get('depot_id') as string | null;
  if (!ecritureId || !depotId) {
    redirect(buildInboxRedirect(formData, { error: 'Écriture et justif requis.' }));
  }
  try {
    await attachDepotToEcritureService({ groupId: ctx.groupId }, depotId, ecritureId);
  } catch (err) {
    redirect(
      buildInboxRedirect(formData, {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  revalidatePath('/inbox');
  revalidatePath('/depots');
  revalidatePath(`/ecritures/${ecritureId}`);
  redirect(buildInboxRedirect(formData, { linked: depotId! }));
}

// Pendant symétrique de markerJustifNonAttendu : marque un dépôt
// orphelin comme "pas pour Baloo" (rejeté). Réutilise le service
// rejectDepot avec un motif par défaut explicite — le trésorier peut
// en saisir un précis depuis /depots si besoin (cas rare).
export async function rejeterDepotInbox(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect(buildInboxRedirect(formData, { error: 'Action réservée aux trésoriers / RG.' }));
  }
  const depotId = formData.get('depot_id') as string | null;
  if (!depotId) {
    redirect(buildInboxRedirect(formData, { error: 'Dépôt requis.' }));
  }
  try {
    await rejectDepotService(
      { groupId: ctx.groupId },
      depotId!,
      'Pas pour Baloo (rejeté depuis l’inbox)',
    );
  } catch (err) {
    redirect(
      buildInboxRedirect(formData, {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  revalidatePath('/inbox');
  revalidatePath('/depots');
  redirect(buildInboxRedirect(formData, { rejected: depotId! }));
}

// Marque l'écriture comme "pas de justif attendu" (justif_attendu = 0).
// L'écriture disparaît de l'inbox, mais reste consultable depuis
// /ecritures et peut être re-marquée justif_attendu = 1 plus tard si
// nécessaire. Réversible, donc pas de modale de confirmation.
export async function markerJustifNonAttendu(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect(buildInboxRedirect(formData, { error: 'Action réservée aux trésoriers / RG.' }));
  }
  const ecritureId = formData.get('ecriture_id') as string | null;
  if (!ecritureId) {
    redirect(buildInboxRedirect(formData, { error: 'Écriture requise.' }));
  }
  try {
    await updateEcriture({ groupId: ctx.groupId }, ecritureId!, { justif_attendu: 0 });
  } catch (err) {
    redirect(
      buildInboxRedirect(formData, {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  revalidatePath('/inbox');
  revalidatePath(`/ecritures/${ecritureId}`);
  redirect(buildInboxRedirect(formData, { dismissed: ecritureId! }));
}
