'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../../context';
import { getDb } from '../../db';
import {
  createRemboursement as createRemboursementService,
  addLigne,
} from '../../services/remboursements';
import { attachJustificatif } from '../../services/justificatifs';
import { parseAmount } from '../../format';
import { sendRemboursementCreatedEmail } from '../../email/remboursement';
import { signAndRefreshRemboursementPdf } from '../../services/remboursement-signing';
import { logError } from '../../log';
import {
  ADMIN_ROLES,
  captureClientMeta,
  deriveAppUrl,
  listAdminEmails,
  parseIdentiteFromForm,
  parseLignesFromForm,
} from './_helpers';

// Ancienne action de création "monoligne" (sans `lignes`). Utilisée
// uniquement par d'éventuels appelants legacy. Les nouveaux flux
// passent par `createMyRemboursement` ou `createForeignRemboursement`.
export async function createRemboursement(formData: FormData) {
  const { groupId, scopeUniteId, userId, role, name, email } = await getCurrentContext();
  const isAdmin = ADMIN_ROLES.includes(role);

  const created = await createRemboursementService(
    { groupId, scopeUniteId },
    {
      demandeur: formData.get('demandeur') as string,
      amount_cents: parseAmount(formData.get('montant') as string),
      date_depense: formData.get('date_depense') as string,
      nature: formData.get('nature') as string,
      unite_id: (formData.get('unite_id') as string) || null,
      justificatif_status: ((formData.get('justificatif_status') as string) || 'en_attente') as
        | 'oui'
        | 'en_attente'
        | 'non',
      mode_paiement_id: (formData.get('mode_paiement_id') as string) || null,
      notes: (formData.get('notes') as string) || null,
      submitted_by_user_id: userId,
    },
  );

  if (!isAdmin) {
    const admins = (await listAdminEmails(groupId)).filter((e) => e !== email);
    if (admins.length > 0) {
      try {
        await sendRemboursementCreatedEmail({
          to: admins,
          rbtId: created.id,
          demandeur: created.demandeur || name || email,
          natureDescription: created.nature ?? '(non précisé)',
          amountCents: created.amount_cents,
          dateDepense: created.date_depense ?? '',
          appUrl: await deriveAppUrl(),
        });
      } catch (err) {
        logError('remboursements', 'Notif admins échouée', err);
      }
    }
  }

  revalidatePath('/remboursements');
  revalidatePath('/');
  redirect(`/remboursements/${created.id}`);
}

// Helper interne partagé entre `createMyRemboursement` (self-service
// par le demandeur) et `createForeignRemboursement` (saisie pour
// autrui par un admin). Retourne l'id de la demande créée. En cas
// d'erreur de validation, redirect vers `backUrl?error=...` (lève donc
// — never).
async function createRemboursementFromForm(
  formData: FormData,
  ctx: {
    groupId: string;
    userId: string;
    email: string;
    scopeUniteId: string | null;
    name: string | null;
    role: string;
  },
  options: {
    backUrl: string;
    /** null en mode foreign (saisie pour autrui), userId en mode self. */
    submittedByUserId: string | null;
  },
): Promise<{ rbtId: string; fullName: string; email: string; totalEstime: number; firstDate: string; firstNature: string }> {
  const fail = (msg: string): never => redirect(options.backUrl + encodeURIComponent(msg));

  const { prenom, nom, email } = parseIdentiteFromForm(formData, fail);
  const lignes = parseLignesFromForm(formData, fail);

  const justifFiles = formData.getAll('justifs').filter((f): f is File => f instanceof File && f.size > 0);
  if (justifFiles.length === 0) fail('Au moins un justificatif (photo / PDF) est requis.');

  const ribFileRaw = formData.get('rib_file');
  const ribFile = ribFileRaw instanceof File && ribFileRaw.size > 0 ? ribFileRaw : null;
  const ribTexte = (formData.get('rib_texte') as string | null)?.trim() || null;

  const fullName = `${prenom} ${nom}`.trim();
  const totalEstime = lignes.reduce((s, l) => s + l.amount_cents, 0);
  const uniteIdRaw = (formData.get('unite_id') as string | null)?.trim() || null;
  const uniteId = ctx.scopeUniteId || uniteIdRaw;

  let created;
  try {
    created = await createRemboursementService(
      { groupId: ctx.groupId },
      {
        demandeur: fullName,
        prenom,
        nom,
        email,
        rib_texte: ribTexte,
        amount_cents: totalEstime,
        date_depense: lignes[0].date,
        nature: lignes[0].nature,
        unite_id: uniteId,
        justificatif_status: 'oui',
        notes: (formData.get('notes') as string | null)?.trim() || null,
        submitted_by_user_id: options.submittedByUserId,
      },
    );
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return null as never;
  }

  for (const l of lignes) {
    await addLigne(created.id, {
      date_depense: l.date,
      amount_cents: l.amount_cents,
      nature: l.nature,
    });
  }

  for (const file of justifFiles) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await attachJustificatif(
        { groupId: ctx.groupId },
        {
          entity_type: 'remboursement',
          entity_id: created.id,
          filename: file.name,
          content: buffer,
          mime_type: file.type || null,
        },
      );
    } catch (err) {
      logError('remboursements', 'Attach justif échoué', err);
    }
  }

  if (ribFile) {
    try {
      const buffer = Buffer.from(await ribFile.arrayBuffer());
      await attachJustificatif(
        { groupId: ctx.groupId },
        {
          entity_type: 'remboursement_rib',
          entity_id: created.id,
          filename: ribFile.name,
          content: buffer,
          mime_type: ribFile.type || null,
        },
      );
      await getDb()
        .prepare('UPDATE remboursements SET rib_file_path = ?, updated_at = ? WHERE id = ?')
        .run(`remboursement_rib/${created.id}/${ribFile.name}`, new Date().toISOString(), created.id);
    } catch (err) {
      logError('remboursements', 'Attach RIB file échoué', err);
    }
  }

  try {
    const meta = await captureClientMeta();
    await signAndRefreshRemboursementPdf({
      groupId: ctx.groupId,
      rbtId: created.id,
      signerRole: 'demandeur',
      signerUserId: options.submittedByUserId,
      signerEmail: email,
      signerName: fullName,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  } catch (err) {
    logError('remboursements', 'Signature + génération PDF feuille échouée', err);
  }

  const admins = (await listAdminEmails(ctx.groupId)).filter((e) => e !== ctx.email);
  if (admins.length > 0 && options.submittedByUserId === ctx.userId && !ADMIN_ROLES.includes(ctx.role)) {
    try {
      await sendRemboursementCreatedEmail({
        to: admins,
        rbtId: created.id,
        demandeur: fullName,
        natureDescription: lignes.length === 1 ? lignes[0].nature : `${lignes.length} lignes de dépense`,
        amountCents: totalEstime,
        dateDepense: lignes[0].date,
        appUrl: await deriveAppUrl(),
      });
    } catch (err) {
      logError('remboursements', 'Notif admins échouée', err);
    }
  }

  return {
    rbtId: created.id,
    fullName,
    email,
    totalEstime,
    firstDate: lignes[0].date,
    firstNature: lignes[0].nature,
  };
}

// Self-service côté demandeur (depuis /moi/remboursements/nouveau).
// La demande sera dans son espace personnel.
export async function createMyRemboursement(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (ctx.role === 'parent') {
    redirect('/moi?error=' + encodeURIComponent('Action non autorisée pour ton rôle.'));
  }

  const result = await createRemboursementFromForm(
    formData,
    ctx,
    {
      backUrl: '/moi/remboursements/nouveau?error=',
      submittedByUserId: ctx.userId,
    },
  );

  revalidatePath('/moi');
  revalidatePath('/remboursements');
  redirect('/moi?rbt_created=' + encodeURIComponent(result.rbtId));
}

// Saisie pour autrui par un admin (depuis /remboursements/nouveau).
// La demande **n'apparaît PAS** dans l'espace perso du saisissant —
// `submitted_by_user_id` est laissé NULL (le bénéficiaire identifié
// par prenom/nom/email saisis ne correspond pas forcément à un user
// Baloo).
export async function createForeignRemboursement(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!['tresorier', 'RG', 'chef'].includes(ctx.role)) {
    redirect('/?error=' + encodeURIComponent('Accès réservé aux trésoriers / RG / chefs.'));
  }

  const result = await createRemboursementFromForm(
    formData,
    ctx,
    {
      backUrl: '/remboursements/nouveau?error=',
      submittedByUserId: null,
    },
  );

  revalidatePath('/remboursements');
  redirect(`/remboursements/${result.rbtId}`);
}
