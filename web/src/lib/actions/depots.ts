'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  createDepot as createDepotService,
  rejectDepot as rejectDepotService,
  updateDepot as updateDepotService,
  attachDepotToEcriture as attachDepotToEcritureService,
  attachDepotToRemboursement as attachDepotToRemboursementService,
  shareDepotToEcriture as shareDepotToEcritureService,
} from '../services/depots';
import { parseAmount } from '../format';
import { validateJustifAttachment, JustificatifValidationError } from '../services/justificatifs';
import { setRembsEcritureLink } from '@/lib/services/remboursement-ecriture-link';
import { rejectSuggestion } from '@/lib/services/inbox-rejets';
import { listTresorierEmails, deriveAppUrl } from '@/lib/actions/remboursements/_helpers';
import { sendDepotCreatedEmail } from '@/lib/email/depot';
import { logError } from '@/lib/log';

const SUBMIT_ROLES = ['tresorier', 'RG', 'chef', 'membre', 'equipier', 'parent'] as const;
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

  const files = formData
    .getAll('file')
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
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

  // Pré-validation (taille / extension / MIME) avant tout INSERT : un
  // fichier refusé ne doit pas laisser de dépôt orphelin.
  for (const f of files) {
    try {
      validateJustifAttachment({ filename: f.name, size: f.size, mime_type: f.type || null });
    } catch (err) {
      const msg = err instanceof JustificatifValidationError ? `${f.name} : ${err.message}` : String(err);
      redirect('/depot?error=' + encodeURIComponent(msg));
    }
  }

  const filesPayload = await Promise.all(
    files.map(async (f) => ({
      filename: f.name,
      content: Buffer.from(await f.arrayBuffer()),
      mime_type: f.type || null,
    })),
  );

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
        activite_id: (formData.get('activite_id') as string | null) || null,
        files: filesPayload,
      },
    );
    depotId = depot.id;
  } catch (err) {
    redirect('/depot?error=' + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }

  // Notifie les TRÉSORIERS DU GROUPE concerné (multi-tenant : la liste est
  // scopée par group_id ; les RG ne reçoivent plus ces notifs). On exclut le
  // déposeur lui-même. Fire-and-forget : un échec mail ne doit pas casser le dépôt.
  try {
    const destinataires = (await listTresorierEmails(ctx.groupId)).filter((e) => e !== ctx.email);
    if (destinataires.length > 0) {
      await sendDepotCreatedEmail({
        to: destinataires,
        depotId,
        titre,
        deposeur: ctx.name ?? ctx.email,
        amountCents: amount_cents,
        dateEstimee: (formData.get('date_estimee') as string | null) || null,
        appUrl: await deriveAppUrl(),
      });
    }
  } catch (err) {
    logError('depots', 'Notif admins (nouveau dépôt) échouée', err);
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

export async function updateDepot(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect('/depots?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const id = formData.get('id') as string | null;
  const titre = (formData.get('titre') as string | null)?.trim() ?? '';
  if (!id || !titre) {
    redirect('/depots?error=' + encodeURIComponent('Titre obligatoire.'));
  }

  const amountRaw = (formData.get('amount') as string | null)?.trim() || null;
  let amount_cents: number | null = null;
  if (amountRaw) {
    try {
      amount_cents = parseAmount(amountRaw);
    } catch {
      redirect('/depots?error=' + encodeURIComponent(`Montant invalide : "${amountRaw}". Utilise le format 12,50.`));
    }
  }

  try {
    await updateDepotService(
      { groupId: ctx.groupId },
      id,
      {
        titre,
        description: (formData.get('description') as string | null)?.trim() || null,
        category_id: (formData.get('category_id') as string | null) || null,
        unite_id: (formData.get('unite_id') as string | null) || null,
        amount_cents,
        date_estimee: (formData.get('date_estimee') as string | null) || null,
        carte_id: (formData.get('carte_id') as string | null) || null,
        activite_id: (formData.get('activite_id') as string | null) || null,
      },
    );
  } catch (err) {
    redirect('/depots?error=' + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }
  revalidatePath('/depots');
  redirect('/depots?updated=' + encodeURIComponent(id));
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

export async function attachDepotToRemboursement(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect('/depots?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const depotId = formData.get('depot_id') as string | null;
  const remboursementId = formData.get('remboursement_id') as string | null;
  if (!depotId || !remboursementId) {
    redirect('/depots?error=' + encodeURIComponent('Dépôt et remboursement requis.'));
  }
  try {
    await attachDepotToRemboursementService({ groupId: ctx.groupId }, depotId, remboursementId);
  } catch (err) {
    redirect('/depots?error=' + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }
  revalidatePath('/depots');
  revalidatePath(`/remboursements/${remboursementId}`);
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

// Partage (paiement scindé) : rattache le justif d'un dépôt DÉJÀ assigné à une
// 2ᵉ écriture. Même forme que attachDepotFromEcriture (form + redirect détail),
// mais appelle shareDepotToEcriture (additif, ne touche pas le dépôt).
export async function shareDepotFromEcriture(formData: FormData): Promise<void> {
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
    await shareDepotToEcritureService({ groupId: ctx.groupId }, depotId, ecritureId);
  } catch (err) {
    redirect(`/ecritures/${ecritureId}?error=` + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }
  revalidatePath(`/ecritures/${ecritureId}`);
  redirect(`/ecritures/${ecritureId}`);
}

// Variantes « en place » de la liaison depuis la bannière de correspondance :
// renvoient un résultat au lieu de rediriger, pour rester dans la vue liste.
export async function linkDepotToEcriture(
  depotId: string,
  ecritureId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) return { ok: false, error: 'Action réservée aux trésoriers / RG.' };
  try {
    await attachDepotToEcritureService({ groupId: ctx.groupId }, depotId, ecritureId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath('/ecritures');
  revalidatePath('/depots');
  return { ok: true };
}

// Partage le justif d'un dépôt DÉJÀ rattaché vers une 2ᵉ écriture (paiement
// scindé). Additif : n'altère ni le dépôt ni son écriture principale.
export async function shareExistingDepotToEcriture(
  depotId: string,
  ecritureId: string,
): Promise<{ ok: boolean; copied?: number; error?: string }> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) return { ok: false, error: 'Action réservée aux trésoriers / RG.' };
  try {
    const { copied } = await shareDepotToEcritureService({ groupId: ctx.groupId }, depotId, ecritureId);
    revalidatePath('/ecritures');
    return { ok: true, copied };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function linkRembToEcriture(
  remboursementId: string,
  ecritureId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) return { ok: false, error: 'Action réservée aux trésoriers / RG.' };
  try {
    const result = await setRembsEcritureLink(ctx.groupId, remboursementId, ecritureId);
    if (!result.ok) return { ok: false, error: result.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath('/ecritures');
  revalidatePath('/remboursements');
  return { ok: true };
}

// « Ne plus proposer » : mémorise le rejet d'une paire (écriture ↔ dépôt /
// remboursement) dans le registre partagé `inbox_suggestion_rejets` pour
// que la bannière de correspondance ne la re-suggère plus jamais. En place
// (renvoie un résultat, pas de redirect) : la bannière se masque côté client.
export async function rejectMatchForEcriture(
  ecritureId: string,
  kind: 'depot' | 'remboursement',
  targetId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) return { ok: false, error: 'Action réservée aux trésoriers / RG.' };
  try {
    await rejectSuggestion({ groupId: ctx.groupId, userId: ctx.userId }, ecritureId, kind, targetId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}
