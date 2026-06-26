'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getCurrentContext } from '../context';
import { getDb } from '../db';
import {
  createAbandon as createAbandonService,
  updateAbandon as updateAbandonService,
  type AbandonStatus,
} from '../services/abandons';
import { applyAbandonTransition } from '../services/abandon-transition';
import {
  attachJustificatif,
  JustificatifValidationError,
  validateJustifAttachment,
} from '../services/justificatifs';
import { parseAmount } from '../format';
import { sendAbandonCreatedEmail } from '../email/abandon';
import { currentTimestamp } from '../ids';
import { requireCanSubmit } from '@/lib/auth/access';

const ADMIN_ROLES = ['tresorier', 'RG'];

async function deriveAppUrl(): Promise<string> {
  const explicit = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (explicit) return explicit;
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : 'https://localhost';
}

async function listAdminEmails(groupId: string): Promise<string[]> {
  const rows = await getDb()
    .prepare(
      "SELECT email FROM users WHERE group_id = ? AND statut = 'actif' AND role IN ('tresorier', 'RG')",
    )
    .all<{ email: string }>(groupId);
  return rows.map((r) => r.email);
}

function pickFile(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  if (value instanceof File && value.size > 0) return value;
  return null;
}

function pickFiles(formData: FormData, key: string): File[] {
  return formData
    .getAll(key)
    .filter((v): v is File => v instanceof File && v.size > 0);
}

async function attachFile(
  groupId: string,
  entityType: string,
  entityId: string,
  file: File,
): Promise<void> {
  validateJustifAttachment({
    filename: file.name,
    size: file.size,
    mime_type: file.type || null,
  });
  const buffer = Buffer.from(await file.arrayBuffer());
  await attachJustificatif(
    { groupId },
    {
      entity_type: entityType,
      entity_id: entityId,
      filename: file.name,
      content: buffer,
      mime_type: file.type || null,
    },
  );
}

// Saisie d'un abandon depuis le formulaire unifie /abandons/nouveau.
// L'identite du donateur est lue dans le formData (champs prenom/nom/email),
// prepopulee cote serveur avec le user connecte mais modifiable dans le form.
// Roles autorises : tous ceux qui peuvent soumettre (cf. SUBMIT_ROLES, dont
// `membre`). Les fichiers (feuille + justifs) sont optionnels — le cas admin
// (rattrapage d'historique) n'a pas toujours les docs.
export async function createAbandon(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  requireCanSubmit(ctx.role);

  const feuille = pickFile(formData, 'feuille');
  const justifs = pickFiles(formData, 'justifs');

  const prenom = ((formData.get('prenom') as string | null)?.trim()) ?? '';
  const nom = ((formData.get('nom') as string | null)?.trim()) ?? '';
  const email = ((formData.get('email') as string | null)?.trim()) ?? '';
  const nature = ((formData.get('nature') as string | null)?.trim()) ?? '';
  const dateDepense = (formData.get('date_depense') as string | null) ?? '';
  const amountRaw = (formData.get('montant') as string | null)?.trim() ?? '';

  if (!prenom || !nom) {
    redirect(
      '/abandons/nouveau?error=' + encodeURIComponent('Prénom et nom du donateur requis.'),
    );
  }
  if (!nature) {
    redirect(
      '/abandons/nouveau?error=' + encodeURIComponent('Nature de la dépense requise.'),
    );
  }
  if (!dateDepense) {
    redirect('/abandons/nouveau?error=' + encodeURIComponent('Date requise.'));
  }
  let amount_cents: number;
  try {
    amount_cents = parseAmount(amountRaw);
  } catch {
    redirect(
      '/abandons/nouveau?error=' +
        encodeURIComponent(`Montant invalide : "${amountRaw}".`),
    );
  }

  // Validation des fichiers (taille / mime). Feuille et justifs sont optionnels
  // (rattrapage d'historique : on saisit pour ne pas perdre l'info, on attache apres).
  try {
    if (feuille) {
      validateJustifAttachment({
        filename: feuille.name,
        size: feuille.size,
        mime_type: feuille.type || null,
      });
    }
    for (const j of justifs) {
      validateJustifAttachment({ filename: j.name, size: j.size, mime_type: j.type || null });
    }
  } catch (err) {
    if (err instanceof JustificatifValidationError) {
      redirect('/abandons/nouveau?error=' + encodeURIComponent(err.message));
    }
    throw err;
  }

  // Annee fiscale = annee de la date de la depense (format YYYY).
  const anneeFiscale = dateDepense.slice(0, 4);
  const fullName = `${prenom} ${nom}`;

  let created;
  try {
    created = await createAbandonService(
      { groupId: ctx.groupId },
      {
        donateur: fullName,
        prenom,
        nom,
        email: email || null,
        amount_cents,
        date_depense: dateDepense,
        nature,
        unite_id: ctx.scopeUniteId || (formData.get('unite_id') as string | null) || null,
        annee_fiscale: anneeFiscale,
        notes: (formData.get('notes') as string | null)?.trim() || null,
        // Le user connecte a soumis la demande (meme si le donateur designe
        // est une autre personne — cas admin saisie pour autrui).
        submitted_by_user_id: ctx.userId,
      },
    );
  } catch (err) {
    redirect(
      '/abandons/nouveau?error=' +
        encodeURIComponent(err instanceof Error ? err.message : String(err)),
    );
  }

  // Attache feuille (entity_type='abandon_feuille') + justifs (entity_type='abandon').
  // Si l'attache echoue on log mais on ne bloque pas — la demande est creee,
  // l'admin pourra ajouter a la main depuis la page detail.
  try {
    if (feuille) {
      await attachFile(ctx.groupId, 'abandon_feuille', created.id, feuille);
    }
    for (const j of justifs) {
      await attachFile(ctx.groupId, 'abandon', created.id, j);
    }
  } catch (err) {
    console.error('[abandons] Attache fichiers echouee :', err);
  }

  // Notif admins (hors le declarant lui-meme s'il est deja admin).
  const admins = (await listAdminEmails(ctx.groupId)).filter((e) => e !== ctx.email);
  if (admins.length > 0) {
    try {
      await sendAbandonCreatedEmail({
        to: admins,
        abandonId: created.id,
        donateur: created.donateur,
        natureDescription: created.nature,
        amountCents: created.amount_cents,
        dateDepense: created.date_depense,
        appUrl: await deriveAppUrl(),
      });
    } catch (err) {
      console.error('[abandons] Notif admins echouee :', err);
    }
  }

  revalidatePath('/');
  revalidatePath('/abandons');
  redirect('/abandons?abandon_created=' + encodeURIComponent(created.id));
}

async function transitionAbandon(
  id: string,
  newStatus: AbandonStatus,
  opts: { motif?: string; sentToNationalAt?: string | null } = {},
): Promise<void> {
  const ctx = await getCurrentContext();

  const result = await applyAbandonTransition(
    { groupId: ctx.groupId, role: ctx.role, userId: ctx.userId },
    id,
    newStatus,
    { motif: opts.motif, sentToNationalAt: opts.sentToNationalAt },
  );

  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        redirect('/abandons?error=' + encodeURIComponent(result.message));
        break;
      default:
        redirect(`/abandons/${id}?error=` + encodeURIComponent(result.message));
    }
  }

  revalidatePath('/abandons');
  revalidatePath(`/abandons/${id}`);
  redirect(`/abandons/${id}?updated=1`);
}

export async function validateAbandon(id: string): Promise<void> {
  await transitionAbandon(id, 'valide');
}

export async function refuseAbandon(id: string, formData: FormData): Promise<void> {
  const motif = ((formData.get('motif') as string | null)?.trim()) ?? '';
  if (!motif) {
    redirect(
      `/abandons/${id}?error=` + encodeURIComponent('Motif de refus requis.'),
    );
  }
  await transitionAbandon(id, 'refuse', { motif });
}

export async function markAbandonSentToNational(id: string): Promise<void> {
  await transitionAbandon(id, 'envoye_national', { sentToNationalAt: currentTimestamp() });
}

// Inchangé côté API : continue de fonctionner depuis la liste avec un
// FormData, mais on ajoute aussi une variante directe `id, value` pour
// la page détail.
export async function toggleCerfaEmis(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect('/abandons?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const id = formData.get('id') as string | null;
  const cerfa = (formData.get('cerfa_emis') as string | null) === '1';
  if (!id) {
    redirect('/abandons?error=' + encodeURIComponent('ID requis.'));
  }
  await updateAbandonService(
    { groupId: ctx.groupId },
    id,
    {
      cerfa_emis: cerfa,
      cerfa_emis_at: cerfa ? currentTimestamp() : null,
    },
  );
  revalidatePath('/abandons');
  revalidatePath(`/abandons/${id}`);
}

export async function setCerfaEmis(id: string, value: boolean): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect(
      `/abandons/${id}?error=` + encodeURIComponent('Action réservée aux trésoriers / RG.'),
    );
  }
  await updateAbandonService(
    { groupId: ctx.groupId },
    id,
    {
      cerfa_emis: value,
      cerfa_emis_at: value ? currentTimestamp() : null,
    },
  );
  revalidatePath('/abandons');
  revalidatePath(`/abandons/${id}`);
  redirect(`/abandons/${id}?updated=1`);
}
