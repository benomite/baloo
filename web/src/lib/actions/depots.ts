'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  createDepot as createDepotService,
  rejectDepot as rejectDepotService,
  attachDepotToEcriture as attachDepotToEcritureService,
} from '../services/depots';
import { parseAmount } from '../format';

const SUBMIT_ROLES = ['tresorier', 'RG', 'chef', 'equipier'] as const;
const ADMIN_ROLES = ['tresorier', 'RG'] as const;

function isSubmitRole(role: string): role is (typeof SUBMIT_ROLES)[number] {
  return (SUBMIT_ROLES as readonly string[]).includes(role);
}
function isAdminRole(role: string): role is (typeof ADMIN_ROLES)[number] {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

export async function createDepot(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isSubmitRole(ctx.role)) {
    redirect('/depot?error=' + encodeURIComponent('Rôle non autorisé à déposer.'));
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    redirect('/depot?error=' + encodeURIComponent('Photo ou PDF du justificatif requis.'));
  }

  const titre = (formData.get('titre') as string | null)?.trim() ?? '';
  if (!titre) {
    redirect('/depot?error=' + encodeURIComponent('Titre requis.'));
  }

  const amountRaw = (formData.get('amount') as string | null)?.trim() || null;
  let amount_cents: number | null = null;
  if (amountRaw) {
    try {
      amount_cents = parseAmount(amountRaw);
    } catch {
      redirect('/depot?error=' + encodeURIComponent(`Montant invalide : "${amountRaw}". Utilise le format 12,50.`));
    }
  }

  const buffer = Buffer.from(await (file as File).arrayBuffer());

  let depotId: string;
  try {
    const depot = await createDepotService(
      { groupId: ctx.groupId, userId: ctx.userId },
      {
        titre,
        description: (formData.get('description') as string | null)?.trim() || null,
        category_id: (formData.get('category_id') as string | null) || null,
        unite_id: (formData.get('unite_id') as string | null) || null,
        amount_cents,
        date_estimee: (formData.get('date_estimee') as string | null) || null,
        carte_id: (formData.get('carte_id') as string | null) || null,
        file: {
          filename: (file as File).name,
          content: buffer,
          mime_type: (file as File).type || null,
        },
      },
    );
    depotId = depot.id;
  } catch (err) {
    redirect('/depot?error=' + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }

  revalidatePath('/depot');
  revalidatePath('/depots');
  redirect('/depot?success=' + encodeURIComponent(depotId));
}

export async function rejectDepot(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect('/depots?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const id = formData.get('id') as string | null;
  const motif = (formData.get('motif') as string | null)?.trim() ?? '';
  if (!id || !motif) {
    redirect('/depots?error=' + encodeURIComponent('Motif obligatoire.'));
  }
  try {
    await rejectDepotService({ groupId: ctx.groupId }, id, motif);
  } catch (err) {
    redirect('/depots?error=' + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }
  revalidatePath('/depots');
  redirect('/depots?rejected=' + encodeURIComponent(id));
}

export async function attachDepotToEcriture(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect('/depots?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const depotId = formData.get('depot_id') as string | null;
  const ecritureId = formData.get('ecriture_id') as string | null;
  if (!depotId || !ecritureId) {
    redirect('/depots?error=' + encodeURIComponent('Dépôt et écriture requis.'));
  }
  try {
    await attachDepotToEcritureService({ groupId: ctx.groupId }, depotId, ecritureId);
  } catch (err) {
    redirect('/depots?error=' + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }
  revalidatePath('/depots');
  revalidatePath(`/ecritures/${ecritureId}`);
  redirect('/depots?attached=' + encodeURIComponent(depotId));
}

// Variante de l'action : sens inverse (l'utilisateur est sur la fiche
// écriture et choisit un dépôt en attente à y rattacher). Même logique,
// redirection finale différente.
export async function attachDepotFromEcriture(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect('/ecritures?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const depotId = formData.get('depot_id') as string | null;
  const ecritureId = formData.get('ecriture_id') as string | null;
  if (!depotId || !ecritureId) {
    redirect('/ecritures?error=' + encodeURIComponent('Dépôt et écriture requis.'));
  }
  try {
    await attachDepotToEcritureService({ groupId: ctx.groupId }, depotId, ecritureId);
  } catch (err) {
    redirect(`/ecritures/${ecritureId}?error=` + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }
  revalidatePath('/depots');
  revalidatePath(`/ecritures/${ecritureId}`);
  redirect(`/ecritures/${ecritureId}`);
}
