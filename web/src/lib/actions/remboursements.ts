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
} from '../services/remboursements';
import { attachJustificatif } from '../services/justificatifs';
import { parseAmount } from '../format';
import {
  sendRemboursementCreatedEmail,
  sendRemboursementStatusChangedEmail,
} from '../email/remboursement';
import { signAndRefreshRemboursementPdf } from '../services/remboursement-signing';

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

// Récupère IP + user agent depuis les headers Next.js. Vercel set
// `x-forwarded-for` ; en local on tombe sur `x-real-ip` ou rien.
async function captureClientMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null;
  const userAgent = h.get('user-agent') || null;
  return { ip, userAgent };
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

// Helper interne partagé entre `createMyRemboursement` (self-service
// par le demandeur) et `createForeignRemboursement` (saisie pour
// autrui par un admin). Retourne l'id de la demande créée. En cas
// d'erreur de validation, redirect vers `backUrl?error=...` (lève donc
// — never).
async function createRemboursementFromForm(
  formData: FormData,
  ctx: { groupId: string; userId: string; email: string; scopeUniteId: string | null; name: string | null; role: string },
  options: {
    backUrl: string;
    /** null en mode foreign (saisie pour autrui), userId en mode self. */
    submittedByUserId: string | null;
  },
): Promise<{ rbtId: string; fullName: string; email: string; totalEstime: number; firstDate: string; firstNature: string }> {
  const fail = (msg: string): never => redirect(options.backUrl + encodeURIComponent(msg));

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
      return null as never;
    }
    lignes.push({ date, nature, amount_cents });
  }

  const justifFiles = formData.getAll('justifs').filter((f): f is File => f instanceof File && f.size > 0);
  if (justifFiles.length === 0) fail('Au moins un justificatif (photo / PDF) est requis.');

  const ribFileRaw = formData.get('rib_file');
  const ribFile = ribFileRaw instanceof File && ribFileRaw.size > 0 ? ribFileRaw : null;
  const ribTexte = (formData.get('rib_texte') as string | null)?.trim() || null;

  const fullName = `${prenom} ${nom}`.trim();
  const totalEstime = lignes.reduce((s, l) => s + l.amount_cents, 0);
  const uniteIdRaw = (formData.get('unite_id') as string | null)?.trim() || null;
  // En mode self, on respecte le scope unité du chef ; en mode foreign,
  // l'admin choisit librement (scopeUniteId est null ou ignoré).
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
      console.error('[remboursements] Attach justif échoué :', err);
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
      console.error('[remboursements] Attach RIB file échoué :', err);
    }
  }

  // Signature "demandeur" + PDF.
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
    console.error('[remboursements] Signature + génération PDF feuille échouée :', err);
  }

  // Notif admins (si la création vient d'un non-admin pour soi-même).
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
      console.error('[remboursements] Notif admins échouée :', err);
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
// Baloo). Si on veut un jour matcher l'email à un user existant pour
// que la demande apparaisse dans /moi du bénéficiaire, on peut le
// faire ici.
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

// Édition d'une demande existante (par le demandeur tant que le
// statut est `a_traiter`, ou par un admin à tout moment). Replace les
// lignes, les champs identité et le RIB. Resigne le document avec un
// hash courant — supprime au préalable les signatures précédentes
// pour garder une chaîne cohérente.
//
// Pour l'édition limitée post-validation (notes + RIB seulement), voir
// `patchNotesAndRib`.
export async function updateMyRemboursement(id: string, formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  const back = `/remboursements/${id}/edit?error=`;
  const fail = (msg: string): never => redirect(back + encodeURIComponent(msg));

  const rbt = await getRemboursement({ groupId: ctx.groupId }, id);
  if (!rbt) fail('Demande introuvable.');

  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const isOwner = !!rbt!.submitted_by_user_id && rbt!.submitted_by_user_id === ctx.userId;
  if (!isAdmin && !isOwner) fail('Tu n’as pas le droit de modifier cette demande.');

  // Édition full uniquement avant validation (statut a_traiter).
  if (rbt!.status !== 'a_traiter' && !isAdmin) {
    fail('La demande a déjà été validée. Seuls les admins peuvent encore la modifier en full.');
  }

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
      return null as never;
    }
    lignes.push({ date, nature, amount_cents });
  }

  const ribTexte = (formData.get('rib_texte') as string | null)?.trim() || null;
  const uniteIdRaw = (formData.get('unite_id') as string | null)?.trim() || null;
  const uniteId = ctx.scopeUniteId || uniteIdRaw;
  const notes = (formData.get('notes') as string | null)?.trim() || null;

  // 1. Update les champs identité + meta sur la table remboursements.
  await getDb().prepare(
    `UPDATE remboursements
     SET demandeur = ?, prenom = ?, nom = ?, email = ?, rib_texte = ?,
         unite_id = ?, notes = ?, updated_at = ?
     WHERE id = ? AND group_id = ?`,
  ).run(
    `${prenom} ${nom}`.trim(),
    prenom,
    nom,
    email,
    ribTexte,
    uniteId,
    notes,
    new Date().toISOString(),
    id,
    ctx.groupId,
  );

  // 2. Replace toutes les lignes.
  await getDb().prepare('DELETE FROM remboursement_lignes WHERE remboursement_id = ?').run(id);
  for (const l of lignes) {
    await addLigne(id, {
      date_depense: l.date,
      amount_cents: l.amount_cents,
      nature: l.nature,
    });
  }

  // 3. Justifs supplémentaires éventuels (les anciens restent attachés).
  const newJustifs = formData.getAll('justifs').filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of newJustifs) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await attachJustificatif(
        { groupId: ctx.groupId },
        {
          entity_type: 'remboursement',
          entity_id: id,
          filename: file.name,
          content: buffer,
          mime_type: file.type || null,
        },
      );
    } catch (err) {
      console.error('[remboursements] Attach justif (edit) échoué :', err);
    }
  }

  // 4. RIB file optionnel (remplace si nouveau).
  const ribFileRaw = formData.get('rib_file');
  const ribFile = ribFileRaw instanceof File && ribFileRaw.size > 0 ? ribFileRaw : null;
  if (ribFile) {
    try {
      const buffer = Buffer.from(await ribFile.arrayBuffer());
      await attachJustificatif(
        { groupId: ctx.groupId },
        {
          entity_type: 'remboursement_rib',
          entity_id: id,
          filename: ribFile.name,
          content: buffer,
          mime_type: ribFile.type || null,
        },
      );
      await getDb()
        .prepare('UPDATE remboursements SET rib_file_path = ?, updated_at = ? WHERE id = ?')
        .run(`remboursement_rib/${id}/${ribFile.name}`, new Date().toISOString(), id);
    } catch (err) {
      console.error('[remboursements] Attach RIB file (edit) échoué :', err);
    }
  }

  // 5. Re-signature : on supprime les signatures précédentes pour
  //    garder une chaîne cohérente, puis on signe à nouveau "demandeur".
  await getDb().prepare("DELETE FROM signatures WHERE document_type = 'remboursement' AND document_id = ?").run(id);
  try {
    const meta = await captureClientMeta();
    await signAndRefreshRemboursementPdf({
      groupId: ctx.groupId,
      rbtId: id,
      signerRole: 'demandeur',
      signerUserId: rbt!.submitted_by_user_id,
      signerEmail: email,
      signerName: `${prenom} ${nom}`.trim(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  } catch (err) {
    console.error('[remboursements] Re-signature (edit) échouée :', err);
  }

  revalidatePath(`/remboursements/${id}`);
  revalidatePath('/moi');
  revalidatePath('/remboursements');
  redirect(`/remboursements/${id}?edited=1`);
}

// Édition limitée post-validation : seulement les notes + RIB texte.
// Pas de re-signature (les notes ne sont pas dans le hash canonique ;
// le RIB est dans le hash mais on assume que sa modification post-
// validation est une exception tracée par audit BDD).
export async function patchNotesAndRib(id: string, formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  const rbt = await getRemboursement({ groupId: ctx.groupId }, id);
  if (!rbt) redirect(`/remboursements/${id}?error=${encodeURIComponent('Demande introuvable.')}`);

  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const isOwner = !!rbt!.submitted_by_user_id && rbt!.submitted_by_user_id === ctx.userId;
  if (!isAdmin && !isOwner) {
    redirect(`/remboursements/${id}?error=${encodeURIComponent('Action non autorisée.')}`);
  }

  const notes = (formData.get('notes') as string | null)?.trim() || null;
  const ribTexte = (formData.get('rib_texte') as string | null)?.trim() || null;

  await getDb().prepare(
    'UPDATE remboursements SET notes = ?, rib_texte = ?, updated_at = ? WHERE id = ? AND group_id = ?',
  ).run(notes, ribTexte, new Date().toISOString(), id, ctx.groupId);

  revalidatePath(`/remboursements/${id}`);
  redirect(`/remboursements/${id}?patched=1`);
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

  // Signature électronique pour les transitions de validation. La
  // signature embarque l'identité du valideur + un hash des données
  // courantes ; la chaîne d'audit garantit l'ordre et l'intégrité.
  if (status === 'valide_tresorier' || status === 'valide_rg') {
    try {
      const meta = await captureClientMeta();
      await signAndRefreshRemboursementPdf({
        groupId: ctx.groupId,
        rbtId: id,
        signerRole: status === 'valide_tresorier' ? 'tresorier' : 'RG',
        signerUserId: ctx.userId,
        signerEmail: ctx.email,
        signerName: ctx.name,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    } catch (err) {
      console.error('[remboursements] Signature validation échouée :', err);
    }
  }

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
