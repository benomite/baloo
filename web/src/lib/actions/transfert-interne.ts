'use server';

// Transfert interne (#51) : qualification d'un brouillon bancaire et lien avec
// la caisse, depuis le panneau d'écriture. Mêmes services que la page Caisse
// et que le MCP (update_ecriture, rapprocher_depot_especes…).

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { getEcriture, updateEcriture } from '../services/ecritures';
import { listDepotsEspeces, attachDepotEspecesToEcriture } from '../services/depots-especes';
import {
  createDepotEspecesAvecMouvement,
  createRetraitEspecesAvecMouvement,
  attachRetraitEspecesToEcriture,
  listRetraitsEspecesEnAttente,
  getOperationCaisseLiee,
  type OperationCaisseLiee,
} from '../services/caisse';
import { patchDeNature, operationCaisseDuMode } from '../transfert-interne';
import type { DepotEspeces, MouvementCaisse } from '../types';

type Resultat = { ok: true } | { ok: false; message: string };

function revalider(ecritureId: string) {
  revalidatePath('/ecritures');
  revalidatePath(`/ecritures/${ecritureId}`);
  revalidatePath('/caisse');
  revalidatePath('/');
}

function enErreur(err: unknown): Resultat {
  return { ok: false, message: err instanceof Error ? err.message : String(err) };
}

export async function qualifierEcriture(ecritureId: string, nature: string): Promise<Resultat> {
  try {
    const { groupId, scopeUniteIds } = await getCurrentContext();
    const updated = await updateEcriture({ groupId, scopeUniteIds }, ecritureId, patchDeNature(nature));
    if (!updated) return { ok: false, message: `Écriture ${ecritureId} introuvable.` };
    revalider(ecritureId);
    return { ok: true };
  } catch (err) {
    return enErreur(err);
  }
}

export interface CaissePourTransfert {
  liee: OperationCaisseLiee | null;
  depotsEnAttente: DepotEspeces[];
  retraitsEnAttente: MouvementCaisse[];
}

// Ce que le panneau montre sous un transfert interne : l'opération de caisse
// déjà liée, sinon celles qu'on peut lier (selon le sens du mode).
export async function fetchCaissePourTransfert(ecritureId: string): Promise<CaissePourTransfert | null> {
  const { groupId, scopeUniteIds } = await getCurrentContext();
  const ecriture = await getEcriture({ groupId, scopeUniteIds }, ecritureId);
  if (!ecriture) return null;
  const sens = operationCaisseDuMode(ecriture.mode_transfert);
  const liee = await getOperationCaisseLiee({ groupId }, ecritureId);
  const [depotsEnAttente, retraitsEnAttente] = await Promise.all([
    sens === 'depot' ? listDepotsEspeces({ groupId }, { pending_only: true }) : Promise.resolve([]),
    sens === 'retrait' ? listRetraitsEspecesEnAttente({ groupId }) : Promise.resolve([]),
  ]);
  return { liee, depotsEnAttente, retraitsEnAttente };
}

export async function lierOperationCaisse(ecritureId: string, operationId: string): Promise<Resultat> {
  try {
    const { groupId, scopeUniteIds } = await getCurrentContext();
    const ecriture = await getEcriture({ groupId, scopeUniteIds }, ecritureId);
    if (!ecriture) return { ok: false, message: `Écriture ${ecritureId} introuvable.` };
    const sens = operationCaisseDuMode(ecriture.mode_transfert);
    if (sens === 'depot') await attachDepotEspecesToEcriture({ groupId }, operationId, ecritureId);
    else if (sens === 'retrait') await attachRetraitEspecesToEcriture({ groupId }, operationId, ecritureId);
    else return { ok: false, message: 'Ce mode de transfert n’a pas de mouvement de caisse à lier.' };
    revalider(ecritureId);
    return { ok: true };
  } catch (err) {
    return enErreur(err);
  }
}

// Crée dans la caisse l'opération du brouillon (même date, même montant, même
// titre) et la lie aussitôt.
export async function creerOperationCaisseDepuisEcriture(ecritureId: string): Promise<Resultat> {
  try {
    const { groupId, scopeUniteIds } = await getCurrentContext();
    const ecriture = await getEcriture({ groupId, scopeUniteIds }, ecritureId);
    if (!ecriture) return { ok: false, message: `Écriture ${ecritureId} introuvable.` };
    const sens = operationCaisseDuMode(ecriture.mode_transfert);
    const commun = {
      total_amount_cents: ecriture.amount_cents,
      description: ecriture.description,
      ecriture_id: ecriture.id,
    };
    if (sens === 'depot') {
      await createDepotEspecesAvecMouvement({ groupId }, { ...commun, date_depot: ecriture.date_ecriture });
    } else if (sens === 'retrait') {
      await createRetraitEspecesAvecMouvement({ groupId }, { ...commun, date_retrait: ecriture.date_ecriture });
    } else {
      return { ok: false, message: 'Ce mode de transfert n’a pas de mouvement de caisse à créer.' };
    }
    revalider(ecritureId);
    return { ok: true };
  } catch (err) {
    return enErreur(err);
  }
}
