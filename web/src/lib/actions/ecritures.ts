'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  updateEcriture as updateEcritureService,
  updateEcritureStatus as updateEcritureStatusService,
  updateEcritureField as updateEcritureFieldService,
  batchUpdateEcritures as batchUpdateEcrituresService,
  deleteDraftEcriture as deleteDraftEcritureService,
  type InlineField,
  type BatchPatch,
  type BatchResult,
} from '../services/ecritures';
import { ECRITURE_STATUSES, type EcritureStatus, type Ecriture } from '../types';
import { parseAmount } from '../format';
import { getDb } from '../db';
import { resyncEcritureDetail } from '../services/sync-cycle';
import { listEcritures, getEcriture, type EcritureFilters } from '../queries/ecritures';
import { listJustificatifsForEcriture, type EcritureJustifsBundle } from '../queries/justificatifs';
import { listDepots, listRattacheDepotsForSharing, type DepotEnriched, type DepotForSharing } from '../services/depots';

/**
 * Pagination des écritures (chargement progressif côté client). Renvoie la
 * page demandée avec les MÊMES filtres que la page serveur (le contexte
 * groupe/scope est résolu côté serveur par `listEcritures`).
 */
export async function fetchEcrituresPage(
  filters: EcritureFilters,
  offset: number,
): Promise<{ ecritures: Ecriture[]; total: number }> {
  return listEcritures({ ...filters, offset });
}

// Note Task 8 (pivot miroir strict) : la server action `createEcriture`
// a été retirée. La page /ecritures/nouveau passe désormais par le
// composant client `NouvelleEcritureWizard` qui POST sur /api/ecritures
// (qui pilote `createEcritureAndPushToCw` : push CW puis miroir local).
// Aucun INSERT direct BDD ne reste côté front pour la saisie manuelle —
// c'est l'invariant du pivot miroir strict.

export async function updateEcriture(id: string, formData: FormData) {
  const { groupId, scopeUniteIds } = await getCurrentContext();
  await updateEcritureService(
    { groupId, scopeUniteIds },
    id,
    {
      date_ecriture: formData.get('date_ecriture') as string,
      description: formData.get('description') as string,
      amount_cents: parseAmount(formData.get('montant') as string),
      type: formData.get('type') as 'depense' | 'recette',
      unite_id: (formData.get('unite_id') as string) || null,
      category_id: (formData.get('category_id') as string) || null,
      mode_paiement_id: (formData.get('mode_paiement_id') as string) || null,
      activite_id: (formData.get('activite_id') as string) || null,
      numero_piece: (formData.get('numero_piece') as string) || null,
      carte_id: (formData.get('carte_id') as string) || null,
      justif_attendu: formData.has('justif_attendu') ? 1 : 0,
      notes: (formData.get('notes') as string) || null,
    },
  );

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  revalidatePath('/');
  // Pas de redirect : on reste sur la page courante (drawer ou page
  // détail). Next va re-render via revalidatePath. Avant on faisait
  // redirect /ecritures/[id] systématiquement, ce qui faisait sortir
  // du drawer après chaque save.
}

export async function updateEcritureStatus(id: string, status: string) {
  // Validation runtime côté code (cf. AGENTS.md : pas de CHECK SQL sur
  // les statuts de workflow). Un statut hors enum est rejeté avec un
  // message clair plutôt que silencieusement appliqué.
  if (!(ECRITURE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Statut écriture invalide : ${status}. Valeurs autorisées : ${ECRITURE_STATUSES.join(', ')}.`);
  }
  const { groupId, scopeUniteIds } = await getCurrentContext();
  await updateEcritureStatusService(
    { groupId, scopeUniteIds },
    id,
    status as EcritureStatus,
  );

  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  revalidatePath('/');
}

// Mise à jour d'un champ unique — utilisé pour l'édition inline depuis la
// table /ecritures (clic sur une cellule → select → save immédiat). Refuse
// sur les écritures déjà synchronisées Comptaweb pour les champs sync.
export async function updateEcritureField(
  id: string,
  field: InlineField,
  value: string | number | null,
): Promise<{ ok: boolean; message?: string }> {
  const { groupId, scopeUniteIds } = await getCurrentContext();
  const result = await updateEcritureFieldService({ groupId, scopeUniteIds }, id, field, value);
  if (!result.ok) {
    if (result.reason === 'not_found') return { ok: false, message: `Écriture ${id} introuvable.` };
    if (result.reason === 'sync_locked') return { ok: false, message: 'Écriture synchronisée Comptaweb — champ non modifiable.' };
    return { ok: false, message: `Champ ${field} non autorisé.` };
  }
  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${id}`);
  return { ok: true };
}

// Suppression d'un brouillon local (status='draft' uniquement, sans pièce
// attachée). Seule exception assumée à la règle no-DELETE — cf. service.
/**
 * Re-synchronise une écriture depuis Comptaweb (action manuelle du drawer) :
 * relit sa page détail, réaligne activité/unité/catégorie + comptaweb_synced.
 * Pratique pour réparer une écriture précise sans lancer un cycle complet.
 */
export async function resyncEcritureDepuisCw(
  id: string,
): Promise<{ ok: boolean; message?: string }> {
  const { groupId } = await getCurrentContext();
  const res = await resyncEcritureDetail(getDb(), groupId, id);
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.reason === 'not_linked'
          ? "Cette écriture n'est pas reliée à Comptaweb (pas d'id CW)."
          : 'Écriture introuvable.',
    };
  }
  revalidatePath('/ecritures');
  return { ok: true };
}

export async function deleteDraft(id: string): Promise<{ ok: boolean; message?: string }> {
  const { groupId, scopeUniteIds } = await getCurrentContext();
  const res = await deleteDraftEcritureService({ groupId, scopeUniteIds }, id);
  if (!res.ok) {
    const messages: Record<typeof res.reason, string> = {
      not_found: `Brouillon ${id} introuvable.`,
      not_draft: 'Seul un brouillon local (jamais envoyé à Comptaweb) peut être supprimé.',
      has_attachments: 'Suppression refusée : ce brouillon a un justificatif, un dépôt ou un remboursement attaché.',
    };
    return { ok: false, message: messages[res.reason] };
  }
  revalidatePath('/ecritures');
  revalidatePath('/');
  return { ok: true };
}

export async function batchUpdateEcritures(ids: string[], patch: BatchPatch): Promise<BatchResult> {
  const { groupId, scopeUniteIds } = await getCurrentContext();
  const result = await batchUpdateEcrituresService({ groupId, scopeUniteIds }, ids, patch);
  if (result.updated > 0) revalidatePath('/ecritures');
  return result;
}

// Charge le détail d'UNE écriture (écriture fraîche + justifs + dépôts en
// attente) pour le panneau d'édition inline. Appelée côté client à
// l'ouverture du panneau : évite de re-render toute la page (l'ancien
// mécanisme `?detail` relançait toutes les requêtes → lent). Renvoie null
// si l'écriture n'existe pas / hors scope.
export async function fetchEcritureDetail(id: string): Promise<{
  ecriture: Ecriture;
  justifsBundle: EcritureJustifsBundle;
  pendingDepots: DepotEnriched[];
  // Dépôts DÉJÀ rattachés ailleurs, proposables au partage (paiement scindé).
  // Uniquement pour les dépenses (une recette n'attend pas de justif).
  shareableDepots: DepotForSharing[];
} | null> {
  const { groupId } = await getCurrentContext();
  const ecriture = await getEcriture(id);
  if (!ecriture) return null;
  const [justifsBundle, pendingDepots, shareableDepots] = await Promise.all([
    listJustificatifsForEcriture(id),
    listDepots({ groupId }, { statut: 'a_traiter' }),
    ecriture.type === 'depense' ? listRattacheDepotsForSharing({ groupId }) : Promise.resolve([]),
  ]);
  return { ecriture, justifsBundle, pendingDepots, shareableDepots };
}

// Recharge UNE écriture avec ses champs d'affichage (unité/catégorie joints,
// has_justificatif, remboursement_id) — pour rafraîchir une seule ligne du
// tableau après une mutation (ex. « Lier »), sans recharger toute la liste.
export async function fetchEcritureRow(id: string): Promise<Ecriture | null> {
  const ecriture = await getEcriture(id);
  return ecriture ?? null;
}
