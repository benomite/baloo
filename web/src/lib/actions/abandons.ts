'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getCurrentContext } from '../context';
import { getDb } from '../db';
import {
  createAbandon as createAbandonService,
  getAbandon,
  isAllowedAbandonTransition,
  updateAbandon as updateAbandonService,
  type AbandonStatus,
} from '../services/abandons';
import {
  attachJustificatif,
  JustificatifValidationError,
  validateJustifAttachment,
} from '../services/justificatifs';
import { parseAmount } from '../format';
import { sendAbandonCreatedEmail } from '../email/abandon';
import { currentTimestamp } from '../ids';

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

export async function createMyAbandon(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (ctx.role === 'parent') {
    redirect('/moi?error=' + encodeURIComponent('Action non autorisée pour ton rôle.'));
  }

  // La feuille d'abandon signée (xlsx complété ou PDF scanné) est
  // obligatoire — c'est le document que l'admin enverra au national.
  const feuille = pickFile(formData, 'feuille');
  if (!feuille) {
    redirect(
      '/moi/abandons/nouveau?error=' +
        encodeURIComponent('Feuille d’abandon signée requise (xlsx ou PDF).'),
    );
  }
  // Au moins un justificatif (tickets, factures, photos).
  const justifs = pickFiles(formData, 'justifs');
  if (justifs.length === 0) {
    redirect(
      '/moi/abandons/nouveau?error=' +
        encodeURIComponent('Au moins un justificatif (ticket, facture) est requis.'),
    );
  }

  // Validation des fichiers (taille / mime).
  try {
    validateJustifAttachment({
      filename: feuille.name,
      size: feuille.size,
      mime_type: feuille.type || null,
    });
    for (const j of justifs) {
      validateJustifAttachment({ filename: j.name, size: j.size, mime_type: j.type || null });
    }
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
    redirect(
      '/moi/abandons/nouveau?error=' + encodeURIComponent('Nature de la dépense requise.'),
    );
  }
  if (!dateDepense) {
    redirect('/moi/abandons/nouveau?error=' + encodeURIComponent('Date requise.'));
  }
  let amount_cents: number;
  try {
    amount_cents = parseAmount(amountRaw);
  } catch {
    redirect(
      '/moi/abandons/nouveau?error=' +
        encodeURIComponent(`Montant invalide : "${amountRaw}".`),
    );
  }

  // Année fiscale = année de la date de la dépense (format YYYY).
  const anneeFiscale = dateDepense.slice(0, 4);

  // Le donateur est le user connecté. On garde le champ legacy
  // `donateur` (concaténation prénom + nom) en plus des champs séparés
  // pour ne pas casser les écrans qui n'ont pas encore migré.
  const fullName = ctx.name ?? ctx.email;
  const [firstFromName, ...restFromName] = fullName.split(/\s+/);
  const prenom = firstFromName ?? null;
  const nom = restFromName.length > 0 ? restFromName.join(' ') : null;

  let created;
  try {
    created = await createAbandonService(
      { groupId: ctx.groupId },
      {
        donateur: fullName,
        prenom,
        nom,
        email: ctx.email,
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
    redirect(
      '/moi/abandons/nouveau?error=' +
        encodeURIComponent(err instanceof Error ? err.message : String(err)),
    );
  }

  // Attache feuille (entity_type='abandon_feuille') + justifs
  // (entity_type='abandon'). Si l'attache échoue on log mais on ne
  // bloque pas — la demande est créée, l'admin pourra ajouter à la
  // main depuis la page détail.
  try {
    await attachFile(ctx.groupId, 'abandon_feuille', created.id, feuille);
    for (const j of justifs) {
      await attachFile(ctx.groupId, 'abandon', created.id, j);
    }
  } catch (err) {
    console.error('[abandons] Attache fichiers échouée :', err);
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

async function transitionAbandon(
  id: string,
  newStatus: AbandonStatus,
  patch: { motif_refus?: string | null; sent_to_national_at?: string | null } = {},
): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect(
      `/abandons/${id}?error=` + encodeURIComponent('Action réservée aux trésoriers / RG.'),
    );
  }
  const current = await getAbandon({ groupId: ctx.groupId }, id);
  if (!current) {
    redirect('/abandons?error=' + encodeURIComponent('Abandon introuvable.'));
  }
  if (!isAllowedAbandonTransition(current.status, newStatus)) {
    redirect(
      `/abandons/${id}?error=` +
        encodeURIComponent(
          `Transition non autorisée : ${current.status} → ${newStatus}.`,
        ),
    );
  }
  await updateAbandonService(
    { groupId: ctx.groupId },
    id,
    { status: newStatus, ...patch },
  );
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
  await transitionAbandon(id, 'refuse', { motif_refus: motif });
}

export async function markAbandonSentToNational(id: string): Promise<void> {
  await transitionAbandon(id, 'envoye_national', {
    sent_to_national_at: currentTimestamp(),
  });
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
