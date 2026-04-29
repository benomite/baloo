'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentContext } from '../context';
import { getDb } from '../db';
import {
  createRemboursement as createRemboursementService,
  getRemboursement,
  updateRemboursement as updateRemboursementService,
} from '../services/remboursements';
import { attachJustificatif } from '../services/justificatifs';
import { parseAmount } from '../format';
import {
  sendRemboursementCreatedEmail,
  sendRemboursementStatusChangedEmail,
} from '../email/remboursement';

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
      // Trace toujours qui a créé, même côté admin (utile pour audit).
      submitted_by_user_id: userId,
    },
  );

  // Notif admins seulement si la création vient d'un non-admin (sinon
  // l'admin se notifie lui-même).
  if (!isAdmin) {
    const admins = (await listAdminEmails(groupId)).filter((e) => e !== email);
    if (admins.length > 0) {
      try {
        await sendRemboursementCreatedEmail({
          to: admins,
          rbtId: created.id,
          demandeur: created.demandeur || name || email,
          natureDescription: created.nature,
          amountCents: created.amount_cents,
          dateDepense: created.date_depense,
          appUrl: await deriveAppUrl(),
        });
      } catch (err) {
        console.error('[remboursements] Notif admins échouée :', err);
      }
    }
  }

  revalidatePath('/remboursements');
  revalidatePath('/');
  redirect(`/remboursements/${created.id}`);
}

// Variante self-service côté demandeur : justif file obligatoire, pas
// de mode de paiement choisi (le trésorier décidera), demandeur
// auto-rempli avec le nom du user connecté.
export async function createMyRemboursement(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (ctx.role === 'parent') {
    redirect('/moi?error=' + encodeURIComponent('Action non autorisée pour ton rôle.'));
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    redirect('/moi/remboursements/nouveau?error=' + encodeURIComponent('Photo / PDF du justificatif requis.'));
  }

  const nature = ((formData.get('nature') as string | null)?.trim()) ?? '';
  const dateDepense = (formData.get('date_depense') as string | null) ?? '';
  const amountRaw = (formData.get('montant') as string | null)?.trim() ?? '';

  if (!nature) {
    redirect('/moi/remboursements/nouveau?error=' + encodeURIComponent('Nature de la dépense requise.'));
  }
  if (!dateDepense) {
    redirect('/moi/remboursements/nouveau?error=' + encodeURIComponent('Date requise.'));
  }
  let amount_cents: number;
  try {
    amount_cents = parseAmount(amountRaw);
  } catch {
    redirect('/moi/remboursements/nouveau?error=' + encodeURIComponent(`Montant invalide : "${amountRaw}".`));
  }

  let created;
  try {
    created = await createRemboursementService(
      { groupId: ctx.groupId },
      {
        demandeur: ctx.name ?? ctx.email,
        amount_cents,
        date_depense: dateDepense,
        nature,
        unite_id: ctx.scopeUniteId ?? (formData.get('unite_id') as string | null) ?? null,
        justificatif_status: 'oui',
        notes: (formData.get('notes') as string | null)?.trim() || null,
        submitted_by_user_id: ctx.userId,
      },
    );
  } catch (err) {
    redirect('/moi/remboursements/nouveau?error=' + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }

  // Attache le file justif.
  const fileObj = file as File;
  const buffer = Buffer.from(await fileObj.arrayBuffer());
  try {
    await attachJustificatif(
      { groupId: ctx.groupId },
      {
        entity_type: 'remboursement',
        entity_id: created.id,
        filename: fileObj.name,
        content: buffer,
        mime_type: fileObj.type || null,
      },
    );
  } catch (err) {
    console.error('[remboursements] Attach justif échoué :', err);
  }

  // Notif admins.
  const admins = (await listAdminEmails(ctx.groupId)).filter((e) => e !== ctx.email);
  if (admins.length > 0) {
    try {
      await sendRemboursementCreatedEmail({
        to: admins,
        rbtId: created.id,
        demandeur: created.demandeur,
        natureDescription: created.nature,
        amountCents: created.amount_cents,
        dateDepense: created.date_depense,
        appUrl: await deriveAppUrl(),
      });
    } catch (err) {
      console.error('[remboursements] Notif admins échouée :', err);
    }
  }

  revalidatePath('/moi');
  revalidatePath('/remboursements');
  redirect('/moi?rbt_created=' + encodeURIComponent(created.id));
}

export async function updateRemboursementStatus(id: string, status: string) {
  const ctx = await getCurrentContext();
  // Seuls les rôles compta peuvent changer le statut. Un equipier qui
  // a déposé sa demande doit attendre la décision du trésorier.
  if (!['tresorier', 'RG', 'chef'].includes(ctx.role)) {
    redirect('/moi?error=' + encodeURIComponent('Action réservée aux trésoriers / chefs.'));
  }
  const today = new Date().toISOString().split('T')[0];
  await updateRemboursementService(
    { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId },
    id,
    {
      status: status as 'demande' | 'valide' | 'paye' | 'refuse',
      ...(status === 'paye' ? { date_paiement: today } : {}),
    },
  );

  // Notif au demandeur si transition pertinente et qu'on connait son user.
  if (status === 'valide' || status === 'paye' || status === 'refuse') {
    try {
      const rbt = await getRemboursement({ groupId: ctx.groupId }, id);
      if (rbt?.submitted_by_user_id && rbt.submitted_by_user_id !== ctx.userId) {
        const submitter = await getDb()
          .prepare('SELECT email, nom_affichage FROM users WHERE id = ?')
          .get<{ email: string; nom_affichage: string | null }>(rbt.submitted_by_user_id);
        if (submitter?.email) {
          await sendRemboursementStatusChangedEmail({
            to: submitter.email,
            invitedName: submitter.nom_affichage,
            rbtId: rbt.id,
            natureDescription: rbt.nature,
            amountCents: rbt.amount_cents,
            newStatus: status,
            motif: rbt.notes,
            appUrl: await deriveAppUrl(),
          });
        }
      }
    } catch (err) {
      console.error('[remboursements] Notif demandeur échouée :', err);
    }
  }

  revalidatePath('/remboursements');
  revalidatePath(`/remboursements/${id}`);
  revalidatePath('/moi');
  revalidatePath('/');
}
