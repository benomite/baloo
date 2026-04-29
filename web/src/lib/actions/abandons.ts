'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getCurrentContext } from '../context';
import { getDb } from '../db';
import {
  createAbandon as createAbandonService,
  updateAbandon as updateAbandonService,
} from '../services/abandons';
import {
  attachJustificatif,
  JustificatifValidationError,
  validateJustifAttachment,
} from '../services/justificatifs';
import { parseAmount } from '../format';
import { sendAbandonCreatedEmail } from '../email/abandon';

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

export async function createMyAbandon(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (ctx.role === 'parent') {
    redirect('/moi?error=' + encodeURIComponent('Action non autorisée pour ton rôle.'));
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    redirect('/moi/abandons/nouveau?error=' + encodeURIComponent('Photo / PDF du justificatif requis.'));
  }
  try {
    validateJustifAttachment({ filename: file.name, size: file.size, mime_type: file.type || null });
  } catch (err) {
    if (err instanceof JustificatifValidationError) {
      redirect('/moi/abandons/nouveau?error=' + encodeURIComponent(err.message));
    }
    throw err;
  }

  const nature = ((formData.get('nature') as string | null)?.trim()) ?? '';
  const dateDepense = (formData.get('date_depense') as string | null) ?? '';
  const amountRaw = (formData.get('montant') as string | null)?.trim() ?? '';

  if (!nature) {
    redirect('/moi/abandons/nouveau?error=' + encodeURIComponent('Nature de la dépense requise.'));
  }
  if (!dateDepense) {
    redirect('/moi/abandons/nouveau?error=' + encodeURIComponent('Date requise.'));
  }
  let amount_cents: number;
  try {
    amount_cents = parseAmount(amountRaw);
  } catch {
    redirect('/moi/abandons/nouveau?error=' + encodeURIComponent(`Montant invalide : "${amountRaw}".`));
  }

  // Année fiscale = année de la date de la dépense (format YYYY).
  const anneeFiscale = dateDepense.slice(0, 4);

  let created;
  try {
    created = await createAbandonService(
      { groupId: ctx.groupId },
      {
        donateur: ctx.name ?? ctx.email,
        amount_cents,
        date_depense: dateDepense,
        nature,
        unite_id: ctx.scopeUniteId || (formData.get('unite_id') as string | null) || null,
        annee_fiscale: anneeFiscale,
        notes: (formData.get('notes') as string | null)?.trim() || null,
        submitted_by_user_id: ctx.userId,
      },
    );
  } catch (err) {
    redirect('/moi/abandons/nouveau?error=' + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }

  // Attache justif.
  const fileObj = file as File;
  const buffer = Buffer.from(await fileObj.arrayBuffer());
  try {
    await attachJustificatif(
      { groupId: ctx.groupId },
      {
        entity_type: 'abandon',
        entity_id: created.id,
        filename: fileObj.name,
        content: buffer,
        mime_type: fileObj.type || null,
      },
    );
  } catch (err) {
    console.error('[abandons] Attach justif échoué :', err);
  }

  // Notif admins.
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
      console.error('[abandons] Notif admins échouée :', err);
    }
  }

  revalidatePath('/moi');
  revalidatePath('/abandons');
  redirect('/moi?abandon_created=' + encodeURIComponent(created.id));
}

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
  await updateAbandonService({ groupId: ctx.groupId }, id, { cerfa_emis: cerfa });
  revalidatePath('/abandons');
}
