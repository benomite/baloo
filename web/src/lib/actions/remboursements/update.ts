'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../../context';
import { getDb } from '../../db';
import { getRemboursement, addLigne } from '../../services/remboursements';
import { attachJustificatif } from '../../services/justificatifs';
import { signAndRefreshRemboursementPdf } from '../../services/remboursement-signing';
import { logError } from '../../log';
import {
  ADMIN_ROLES,
  captureClientMeta,
  parseIdentiteFromForm,
  parseLignesFromForm,
  validateJustifFiles,
} from './_helpers';

// Édition full d'une demande : identité + lignes + justifs + RIB.
// Replace toutes les lignes et resigne le document.
//
// Permissions :
//  - admin (tresorier / RG) : à tout moment, n'importe quel statut.
//  - demandeur (owner) : uniquement avant validation (statut a_traiter).
//
// Pour l'édition limitée post-validation (notes + RIB), voir
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

  if (rbt!.status !== 'a_traiter' && !isAdmin) {
    fail('La demande a déjà été validée. Seuls les admins peuvent encore la modifier en full.');
  }

  const { prenom, nom, email } = parseIdentiteFromForm(formData, fail);
  const lignes = parseLignesFromForm(formData, fail);

  const ribTexte = (formData.get('rib_texte') as string | null)?.trim() || null;
  const uniteIdRaw = (formData.get('unite_id') as string | null)?.trim() || null;
  const uniteId = ctx.scopeUniteId || uniteIdRaw;
  const notes = (formData.get('notes') as string | null)?.trim() || null;

  // Pré-validation des éventuels nouveaux justifs / RIB avant tout
  // UPDATE — on évite un état partiellement modifié si un fichier est
  // refusé.
  const newJustifs = formData.getAll('justifs').filter((f): f is File => f instanceof File && f.size > 0);
  const ribFileRaw = formData.get('rib_file');
  const ribFile = ribFileRaw instanceof File && ribFileRaw.size > 0 ? ribFileRaw : null;
  validateJustifFiles(ribFile ? [...newJustifs, ribFile] : newJustifs, fail);

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

  await getDb().prepare('DELETE FROM remboursement_lignes WHERE remboursement_id = ?').run(id);
  for (const l of lignes) {
    await addLigne(id, {
      date_depense: l.date,
      amount_cents: l.amount_cents,
      nature: l.nature,
    });
  }

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
      logError('remboursements', 'Attach justif (edit) échoué', err);
    }
  }

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
      logError('remboursements', 'Attach RIB file (edit) échoué', err);
    }
  }

  // Re-signature : on supprime les signatures précédentes pour garder
  // une chaîne cohérente, puis on signe à nouveau "demandeur".
  await getDb()
    .prepare("DELETE FROM signatures WHERE document_type = 'remboursement' AND document_id = ?")
    .run(id);
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
    logError('remboursements', 'Re-signature (edit) échouée', err);
  }

  revalidatePath(`/remboursements/${id}`);
  revalidatePath('/moi');
  revalidatePath('/remboursements');
  redirect(`/remboursements/${id}?edited=1`);
}

// Édition limitée post-validation : seulement notes + RIB texte. Pas
// de re-signature (les notes ne sont pas dans le hash canonique ; le
// RIB l'est mais on assume sa modification post-validation comme
// exception tracée par audit BDD).
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
