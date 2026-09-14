'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getCurrentContext } from '../context';
import { resolveScopedUnite } from '../scope';
import { getDb } from '../db';
import {
  createAbandon as createAbandonService,
  canEditAbandon,
  editAbandon,
  getAbandon,
  updateAbandon as updateAbandonService,
  type AbandonStatus,
  type EditAbandonInput,
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

// Champs métier du formulaire abandon, communs à la création et à l'édition.
// Redirige vers `errorPath` avec le message si une saisie est invalide.
function readAbandonFields(
  formData: FormData,
  errorPath: string,
  scopeUniteIds: string[],
): EditAbandonInput {
  const fail = (msg: string): never =>
    redirect(`${errorPath}?error=` + encodeURIComponent(msg));

  const prenom = ((formData.get('prenom') as string | null)?.trim()) ?? '';
  const nom = ((formData.get('nom') as string | null)?.trim()) ?? '';
  const email = ((formData.get('email') as string | null)?.trim()) ?? '';
  const nature = ((formData.get('nature') as string | null)?.trim()) ?? '';
  const dateDepense = (formData.get('date_depense') as string | null) ?? '';
  const amountRaw = (formData.get('montant') as string | null)?.trim() ?? '';

  if (!prenom || !nom) fail('Prénom et nom du donateur requis.');
  if (!nature) fail('Nature de la dépense requise.');
  if (!dateDepense) fail('Date requise.');
  let amount_cents = 0;
  try {
    amount_cents = parseAmount(amountRaw);
  } catch {
    fail(`Montant invalide : "${amountRaw}".`);
  }
  let unite_id: string | null = null;
  try {
    unite_id = resolveScopedUnite(
      scopeUniteIds,
      (formData.get('unite_id') as string | null) || null,
    );
  } catch (err) {
    fail(err instanceof Error ? err.message : 'Unité invalide.');
  }

  return {
    donateur: `${prenom} ${nom}`,
    prenom,
    nom,
    email: email || null,
    amount_cents,
    date_depense: dateDepense,
    nature,
    unite_id,
    // Annee fiscale = annee de la date de la depense (format YYYY).
    annee_fiscale: dateDepense.slice(0, 4),
    notes: (formData.get('notes') as string | null)?.trim() || null,
  };
}

// Feuille + justifs optionnels (rattrapage d'historique : on saisit pour ne
// pas perdre l'info, on attache apres). Validation taille / mime avant
// toute ecriture en BDD.
function readAbandonFiles(
  formData: FormData,
  errorPath: string,
): { feuille: File | null; justifs: File[] } {
  const feuille = pickFile(formData, 'feuille');
  const justifs = pickFiles(formData, 'justifs');
  try {
    for (const f of feuille ? [feuille, ...justifs] : justifs) {
      validateJustifAttachment({ filename: f.name, size: f.size, mime_type: f.type || null });
    }
  } catch (err) {
    if (err instanceof JustificatifValidationError) {
      redirect(`${errorPath}?error=` + encodeURIComponent(err.message));
    }
    throw err;
  }
  return { feuille, justifs };
}

async function attachAbandonFiles(
  groupId: string,
  abandonId: string,
  files: { feuille: File | null; justifs: File[] },
): Promise<void> {
  // Si l'attache echoue on log mais on ne bloque pas — la demande est
  // enregistree, on pourra rajouter la piece depuis l'edition.
  try {
    if (files.feuille) {
      await attachFile(groupId, 'abandon_feuille', abandonId, files.feuille);
    }
    for (const j of files.justifs) {
      await attachFile(groupId, 'abandon', abandonId, j);
    }
  } catch (err) {
    console.error('[abandons] Attache fichiers echouee :', err);
  }
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

  const errorPath = '/abandons/nouveau';
  const fields = readAbandonFields(formData, errorPath, ctx.scopeUniteIds);
  const { feuille, justifs } = readAbandonFiles(formData, errorPath);

  let created;
  try {
    created = await createAbandonService(
      { groupId: ctx.groupId },
      {
        ...fields,
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

  await attachAbandonFiles(ctx.groupId, created.id, { feuille, justifs });

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

// Édition d'une demande encore `a_traiter` (demandeur ou admin) : champs
// métier + ajout de pièces. Les pièces déjà attachées sont conservées —
// les nouveaux fichiers s'ajoutent.
export async function updateAbandon(id: string, formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  const errorPath = `/abandons/${id}/edit`;

  const existing = await getAbandon({ groupId: ctx.groupId }, id);
  if (!existing) {
    redirect('/abandons?error=' + encodeURIComponent('Demande introuvable.'));
  }
  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const isOwner =
    !!existing.submitted_by_user_id && existing.submitted_by_user_id === ctx.userId;
  if (!canEditAbandon(existing.status, { isAdmin, isOwner })) {
    redirect(
      `/abandons/${id}?error=` +
        encodeURIComponent('Cette demande n’est plus modifiable (elle n’est plus à traiter).'),
    );
  }

  const fields = readAbandonFields(formData, errorPath, ctx.scopeUniteIds);
  const files = readAbandonFiles(formData, errorPath);

  const updated = await editAbandon({ groupId: ctx.groupId }, id, fields);
  if (!updated) {
    redirect(
      `/abandons/${id}?error=` +
        encodeURIComponent('La demande a changé de statut entre-temps, modification non enregistrée.'),
    );
  }

  await attachAbandonFiles(ctx.groupId, id, files);

  revalidatePath('/');
  revalidatePath('/abandons');
  revalidatePath(`/abandons/${id}`);
  redirect(`/abandons/${id}?updated=1`);
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
