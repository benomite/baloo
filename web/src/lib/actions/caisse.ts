'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  createMouvementCaisse as createMouvementCaisseService,
  createDepotEspecesAvecMouvement,
} from '../services/caisse';
import { attachDepotEspecesToEcriture } from '../services/depots-especes';
import {
  syncCaisseFromComptaweb,
  resolveCaisseId,
  archiveOrphanedCaisseRows,
} from '../services/caisse-sync';
import { parseOmniboxInput, isOmniboxError } from '../services/caisse-omnibox';
import { listUnites } from './../services/reference';
import { parseAmount } from '../format';
import { logError } from '../log';

export async function createMouvementCaisse(formData: FormData) {
  const ctx = await getCurrentContext();

  // Sens explicite : "entree" (positif) ou "sortie" (négatif). Plus
  // robuste que de demander à saisir +/- dans le montant.
  const sens = (formData.get('sens') as string | null) ?? 'sortie';
  const amount = parseAmount(formData.get('montant') as string);
  const signed = sens === 'entree' ? Math.abs(amount) : -Math.abs(amount);

  await createMouvementCaisseService(
    { groupId: ctx.groupId },
    {
      date_mouvement: formData.get('date_mouvement') as string,
      description: formData.get('description') as string,
      amount_cents: signed,
      type: sens === 'entree' ? 'entree' : 'sortie',
      unite_id: (formData.get('unite_id') as string) || null,
      activite_id: (formData.get('activite_id') as string) || null,
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/caisse');
  revalidatePath('/');
}

// Saisie express via omnibox : 1 chaîne libre `+180 extra-job rouges` →
// 1 mouvement caisse créé instantanément, unité auto-détectée si
// possible. Si la saisie est invalide, redirect avec un message
// d'erreur préservant le texte saisi pour correction.
export async function quickAddCaisse(formData: FormData) {
  const ctx = await getCurrentContext();
  const raw = ((formData.get('input') as string | null) ?? '').trim();
  if (!raw) {
    redirect('/caisse?qa_error=' + encodeURIComponent('Saisie vide.'));
  }

  const unites = await listUnites({ groupId: ctx.groupId });
  const parsed = parseOmniboxInput(raw, unites);

  if (isOmniboxError(parsed)) {
    redirect(
      '/caisse?qa_input=' + encodeURIComponent(raw) +
      '&qa_error=' + encodeURIComponent(parsed.error),
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  await createMouvementCaisseService(
    { groupId: ctx.groupId },
    {
      date_mouvement: today,
      description: parsed.description,
      amount_cents: parsed.amount_cents,
      type: parsed.amount_cents >= 0 ? 'entree' : 'sortie',
      unite_id: parsed.unite_id,
      notes: parsed.warnings.length > 0 ? parsed.warnings.join(' ') : null,
    },
  );

  revalidatePath('/caisse');
  revalidatePath('/');

  const successParts: string[] = [];
  if (parsed.unite_match_label) successParts.push(`unite=${parsed.unite_match_label}`);
  if (parsed.warnings.length) successParts.push('warn');
  const successMsg = successParts.length ? successParts.join('|') : '1';
  redirect('/caisse?qa_ok=' + encodeURIComponent(successMsg));
}

export async function createDepotEspecesAction(formData: FormData) {
  const ctx = await getCurrentContext();

  const total = parseAmount(formData.get('montant') as string);
  if (total <= 0) {
    throw new Error('Le montant du dépôt doit être strictement positif.');
  }

  await createDepotEspecesAvecMouvement(
    { groupId: ctx.groupId },
    {
      date_depot: formData.get('date_depot') as string,
      total_amount_cents: total,
      description: (formData.get('description') as string) || null,
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/caisse');
  revalidatePath('/');
}

export async function rapprocherDepotEspecesAction(formData: FormData) {
  const ctx = await getCurrentContext();
  const depotId = formData.get('depot_id') as string;
  const ecritureId = formData.get('ecriture_id') as string;
  if (!depotId || !ecritureId) {
    throw new Error('Dépôt et écriture banque requis.');
  }
  await attachDepotEspecesToEcriture({ groupId: ctx.groupId }, depotId, ecritureId);
  revalidatePath('/caisse');
  revalidatePath('/');
}

export async function archiveOrphanedCaisseRowsAction() {
  const ctx = await getCurrentContext();
  await archiveOrphanedCaisseRows(ctx.groupId);
  revalidatePath('/caisse');
  revalidatePath('/');
}

export async function syncCaisseFromComptawebAction(formData: FormData) {
  try {
    const ctx = await getCurrentContext();
    let caisseId = Number(formData.get('caisse_id'));
    if (!caisseId || Number.isNaN(caisseId)) {
      caisseId = await resolveCaisseId();
    }
    const result = await syncCaisseFromComptaweb(ctx.groupId, caisseId);
    console.log(
      `[caisse/sync] OK caisse=${caisseId} stats=${JSON.stringify(result.stats)} soldeBaloo=${result.soldeBaloo} soldeCW=${result.soldeComptaweb}`,
    );
    revalidatePath('/caisse');
    revalidatePath('/');
  } catch (err) {
    const data: Record<string, unknown> = {
      caisseIdFromForm: formData.get('caisse_id'),
    };
    // Embarque les champs de diagnostic posés par fetchCaisseList (cf.
    // throw avec Object.assign) dans le log /admin/errors.
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      for (const k of ['htmlSample', 'selects', 'options']) {
        if (k in e) data[k] = e[k];
      }
    }
    logError('caisse/sync/action', 'sync failed', err, data);
    throw err;
  }
}
