'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../../context';
import { resolveScopedUnite } from '../../scope';
import { getDb } from '../../db';
import {
  createRemboursement as createRemboursementService,
  addLigne,
} from '../../services/remboursements';
import { attachTeleversement } from '../../services/justif-televersements';
import { getGroupe } from '../../services/groupes';
import { sendRemboursementCreatedEmail } from '../../email/remboursement';
import { signAndRefreshRemboursementPdf } from '../../services/remboursement-signing';
import { logError } from '../../log';
import {
  ADMIN_ROLES,
  captureClientMeta,
  deriveAppUrl,
  FormValidationError,
  listTresorierEmails,
  parseIdentiteFromForm,
  parseLignesFromForm,
  resolveLignesWithRate,
  resolveFormUploads,
  runFormAction,
  type RembFormState,
} from './_helpers';

// Helper interne. Retourne les métadonnées de la demande créée. En cas
// d'erreur de validation, lève `FormValidationError` (capturée par la
// server action, convertie en `{ error }` sans recharger la page).
async function createRemboursementFromForm(
  formData: FormData,
  ctx: {
    groupId: string;
    userId: string;
    email: string;
    scopeUniteIds: string[];
    name: string | null;
    role: string;
  },
  options: {
    /** null en mode foreign (saisie pour autrui), userId en mode self. */
    submittedByUserId: string | null;
  },
): Promise<{ rbtId: string; fullName: string; email: string; totalEstime: number; firstDate: string; firstNature: string }> {
  const fail = (msg: string): never => {
    throw new FormValidationError(msg);
  };

  const { prenom, nom, email } = parseIdentiteFromForm(formData, fail);
  const lignes = parseLignesFromForm(formData, fail);

  const groupe = await getGroupe({ groupId: ctx.groupId });
  const tauxKm = groupe?.taux_km_millicents ?? 354;
  const resolvedLignes = resolveLignesWithRate(lignes, tauxKm);

  // Fichiers déjà téléversés par le navigateur : on ne reçoit que des
  // références, vérifiées (propriétaire / taille / extension / MIME) avant
  // tout INSERT pour ne pas laisser de demande orpheline si l'une est
  // refusée.
  const justifs = await resolveFormUploads(ctx, formData, 'justifs', fail);
  if (justifs.length === 0) fail('Au moins un justificatif (photo / PDF) est requis.');

  const [ribFile = null] = await resolveFormUploads(ctx, formData, 'rib_file', fail);
  const ribTexte = (formData.get('rib_texte') as string | null)?.trim() || null;

  const fullName = `${prenom} ${nom}`.trim();
  const totalEstime = resolvedLignes.reduce((s, l) => s + l.amount_cents, 0);
  const uniteIdRaw = (formData.get('unite_id') as string | null)?.trim() || null;
  let uniteId: string | null;
  try {
    uniteId = resolveScopedUnite(ctx.scopeUniteIds, uniteIdRaw);
  } catch (e) {
    throw new FormValidationError(e instanceof Error ? e.message : 'Unité invalide.');
  }

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

  for (const l of resolvedLignes) {
    await addLigne(created.id, {
      date_depense: l.date,
      amount_cents: l.amount_cents,
      nature: l.nature,
      type: l.type,
      distance_km_dixiemes: l.distance_km_dixiemes,
      taux_km_millicents: l.taux_km_millicents,
    });
  }

  for (const tv of justifs) {
    try {
      await attachTeleversement(ctx, tv, { entity_type: 'remboursement', entity_id: created.id });
    } catch (err) {
      logError('remboursements', 'Attach justif échoué', err);
    }
  }

  if (ribFile) {
    try {
      await attachTeleversement(ctx, ribFile, { entity_type: 'remboursement_rib', entity_id: created.id });
      await getDb()
        .prepare('UPDATE remboursements SET rib_file_path = ?, updated_at = ? WHERE id = ?')
        .run(ribFile.pathname, new Date().toISOString(), created.id);
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

  const destinataires = (await listTresorierEmails(ctx.groupId)).filter((e) => e !== ctx.email);
  if (destinataires.length > 0 && options.submittedByUserId === ctx.userId && !ADMIN_ROLES.includes(ctx.role)) {
    try {
      await sendRemboursementCreatedEmail({
        to: destinataires,
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

// Formulaire unifié de création (depuis /remboursements/nouveau).
// Accessible à tous les rôles qui peuvent soumettre (dont `membre`).
// Le demandeur (prenom/nom/email) est lu depuis formData — la page
// préremplie les champs avec l'utilisateur connecté, mais chacun peut
// les modifier.
// La demande est rattachée au user connecté (submitted_by_user_id =
// ctx.userId) pour apparaître dans « Mes demandes » sur la home.
export async function createRemboursement(
  _prevState: RembFormState,
  formData: FormData,
): Promise<RembFormState> {
  return runFormAction(async () => {
    const ctx = await getCurrentContext();
    // `membre` = rôle unifié autorisé ; `equipier`/`parent` tolérés en legacy.
    if (!['tresorier', 'RG', 'chef', 'membre', 'equipier', 'parent'].includes(ctx.role)) {
      throw new FormValidationError('Action non autorisée pour ton rôle.');
    }

    const result = await createRemboursementFromForm(formData, ctx, {
      submittedByUserId: ctx.userId,
    });

    revalidatePath('/');
    revalidatePath('/remboursements');
    redirect('/remboursements?rbt_created=' + encodeURIComponent(result.rbtId));
  });
}
