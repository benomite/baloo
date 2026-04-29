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
  addLigne,
  listLignes,
} from '../services/remboursements';
import { attachJustificatif } from '../services/justificatifs';
import { parseAmount } from '../format';
import {
  sendRemboursementCreatedEmail,
  sendRemboursementStatusChangedEmail,
} from '../email/remboursement';
import { renderFeuilleRemboursementPdf } from '../pdf/feuille-remboursement';

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
          natureDescription: created.nature ?? '(non précisé)',
          amountCents: created.amount_cents,
          dateDepense: created.date_depense ?? '',
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

// Variante self-service côté demandeur : multi-lignes + RIB + génération
// auto de la feuille de remboursement PDF (chantier 2-bis).
//
// Inputs FormData :
//   prenom, nom, email, rib_texte, rib_file?, justifs (multiple, requis),
//   ligne_count, ligne_0_date, ligne_0_montant, ligne_0_nature, ...,
//   unite_id?, notes?, certif (checkbox)
export async function createMyRemboursement(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (ctx.role === 'parent') {
    redirect('/moi?error=' + encodeURIComponent('Action non autorisée pour ton rôle.'));
  }

  const back = '/moi/remboursements/nouveau?error=';
  const fail = (msg: string): never => redirect(back + encodeURIComponent(msg));

  // Identité.
  const prenom = (formData.get('prenom') as string | null)?.trim() ?? '';
  const nom = (formData.get('nom') as string | null)?.trim() ?? '';
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!prenom || !nom || !email) fail('Prénom, nom et email obligatoires.');

  // Lignes.
  const ligneCount = parseInt((formData.get('ligne_count') as string | null) ?? '0', 10);
  if (!ligneCount || ligneCount < 1) fail('Au moins une ligne de dépense est requise.');

  type LigneInput = { date: string; nature: string; amount_cents: number };
  const lignes: LigneInput[] = [];
  for (let i = 0; i < ligneCount; i++) {
    const date = (formData.get(`ligne_${i}_date`) as string | null) ?? '';
    const nature = ((formData.get(`ligne_${i}_nature`) as string | null) ?? '').trim();
    const montantRaw = ((formData.get(`ligne_${i}_montant`) as string | null) ?? '').trim();
    if (!date || !nature || !montantRaw) fail(`Ligne ${i + 1} incomplète.`);
    let amount_cents: number;
    try {
      amount_cents = parseAmount(montantRaw);
    } catch {
      fail(`Ligne ${i + 1} : montant invalide « ${montantRaw} ».`);
      return; // unreachable, fail() throws
    }
    lignes.push({ date, nature, amount_cents });
  }

  // Justifs (multiple, au moins 1 requis).
  const justifFiles = formData.getAll('justifs').filter((f): f is File => f instanceof File && f.size > 0);
  if (justifFiles.length === 0) fail('Au moins un justificatif (photo / PDF) est requis.');

  // RIB (file optionnel).
  const ribFileRaw = formData.get('rib_file');
  const ribFile = ribFileRaw instanceof File && ribFileRaw.size > 0 ? ribFileRaw : null;
  const ribTexte = (formData.get('rib_texte') as string | null)?.trim() || null;

  // Crée la demande (sans lignes pour l'instant ; total et amount mis à 0,
  // recalculés ensuite par addLigne).
  const fullName = `${prenom} ${nom}`.trim();
  const totalEstime = lignes.reduce((s, l) => s + l.amount_cents, 0);
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
        unite_id: ctx.scopeUniteId ?? (formData.get('unite_id') as string | null) ?? null,
        justificatif_status: 'oui',
        notes: (formData.get('notes') as string | null)?.trim() || null,
        submitted_by_user_id: ctx.userId,
      },
    );
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  // Insère les lignes (recalcul du total à chaque addLigne, c'est OK
  // pour le volume attendu).
  for (const l of lignes) {
    await addLigne(created.id, {
      date_depense: l.date,
      amount_cents: l.amount_cents,
      nature: l.nature,
    });
  }

  // Attache les justifs (entity_type='remboursement').
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
      console.error('[remboursements] Attach justif échoué :', err);
    }
  }

  // Attache le RIB si fichier fourni (entity_type='remboursement_rib').
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
      // Met à jour rib_file_path sur la demande pour le PDF.
      await getDb()
        .prepare('UPDATE remboursements SET rib_file_path = ?, updated_at = ? WHERE id = ?')
        .run(`remboursement_rib/${created.id}/${ribFile.name}`, new Date().toISOString(), created.id);
    } catch (err) {
      console.error('[remboursements] Attach RIB file échoué :', err);
    }
  }

  // Génère la feuille PDF, l'attache (entity_type='remboursement_feuille').
  try {
    const groupRow = await getDb()
      .prepare('SELECT nom FROM groupes WHERE id = ?')
      .get<{ nom: string }>(ctx.groupId);
    const finalRbt = await getRemboursement({ groupId: ctx.groupId }, created.id);
    const finalLignes = await listLignes(created.id);
    if (finalRbt) {
      const pdfBuffer = await renderFeuilleRemboursementPdf({
        rbt: finalRbt,
        lignes: finalLignes,
        groupName: groupRow?.nom ?? 'le groupe',
        submittedAt: new Date().toISOString().slice(0, 10),
      });
      await attachJustificatif(
        { groupId: ctx.groupId },
        {
          entity_type: 'remboursement_feuille',
          entity_id: created.id,
          filename: `feuille-${created.id}.pdf`,
          content: pdfBuffer,
          mime_type: 'application/pdf',
        },
      );
    }
  } catch (err) {
    console.error('[remboursements] Génération PDF feuille échouée :', err);
  }

  // Notif admins.
  const admins = (await listAdminEmails(ctx.groupId)).filter((e) => e !== ctx.email);
  if (admins.length > 0) {
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
      console.error('[remboursements] Notif admins échouée :', err);
    }
  }

  revalidatePath('/moi');
  revalidatePath('/remboursements');
  redirect('/moi?rbt_created=' + encodeURIComponent(created.id));
}

// Garde de transitions : qui peut faire quoi sur la timeline 5 statuts.
const TRANSITIONS: Record<string, { from: string[]; allowedRoles: string[] }> = {
  valide_tresorier: { from: ['a_traiter'], allowedRoles: ['tresorier'] },
  valide_rg: { from: ['valide_tresorier'], allowedRoles: ['RG'] },
  virement_effectue: { from: ['valide_rg'], allowedRoles: ['tresorier', 'RG'] },
  termine: { from: ['virement_effectue'], allowedRoles: ['tresorier', 'RG'] },
  refuse: {
    from: ['a_traiter', 'valide_tresorier', 'valide_rg', 'virement_effectue'],
    allowedRoles: ['tresorier', 'RG'],
  },
};

// Note signature : `formData` en dernier argument permet de l'utiliser
// comme `<form action={updateRemboursementStatus.bind(null, id, status)}>`,
// le form fournit FormData et on en extrait le motif si présent.
export async function updateRemboursementStatus(id: string, status: string, formData?: FormData) {
  const motif = formData?.get('motif')?.toString() || undefined;
  const ctx = await getCurrentContext();

  const transition = TRANSITIONS[status];
  if (!transition) {
    redirect(`/remboursements/${id}?error=` + encodeURIComponent(`Statut inconnu : ${status}.`));
  }
  if (!transition.allowedRoles.includes(ctx.role)) {
    redirect(`/remboursements/${id}?error=` + encodeURIComponent(`Action réservée aux rôles : ${transition.allowedRoles.join(' / ')}.`));
  }

  const rbt = await getRemboursement({ groupId: ctx.groupId }, id);
  if (!rbt) {
    redirect('/remboursements?error=' + encodeURIComponent('Demande introuvable.'));
  }
  if (!transition.from.includes(rbt.status)) {
    redirect(`/remboursements/${id}?error=` + encodeURIComponent(`Transition impossible depuis le statut « ${rbt.status} ».`));
  }

  const today = new Date().toISOString().split('T')[0];
  await updateRemboursementService(
    { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId },
    id,
    {
      status: status as 'a_traiter' | 'valide_tresorier' | 'valide_rg' | 'virement_effectue' | 'termine' | 'refuse',
      ...(status === 'virement_effectue' ? { date_paiement: today } : {}),
      ...(status === 'refuse' && motif ? { motif_refus: motif } : {}),
    },
  );

  // Notif au demandeur si transition pertinente et qu'on connaît son user.
  if (status === 'valide_tresorier' || status === 'valide_rg' || status === 'virement_effectue' || status === 'termine' || status === 'refuse') {
    try {
      if (rbt.submitted_by_user_id && rbt.submitted_by_user_id !== ctx.userId) {
        const submitter = await getDb()
          .prepare('SELECT email, nom_affichage FROM users WHERE id = ?')
          .get<{ email: string; nom_affichage: string | null }>(rbt.submitted_by_user_id);
        if (submitter?.email) {
          await sendRemboursementStatusChangedEmail({
            to: submitter.email,
            invitedName: submitter.nom_affichage,
            rbtId: rbt.id,
            natureDescription: rbt.nature ?? '',
            amountCents: rbt.total_cents || rbt.amount_cents,
            newStatus: status,
            motif: motif ?? rbt.motif_refus,
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
