import { getCurrentContext } from '../context';
import {
  listCategories as listCategoriesService,
  listModesPaiement as listModesPaiementService,
  listUnites as listUnitesService,
  listActivites as listActivitesService,
  getTopCategoryIdsForGroup as getTopCategoryIdsForGroupService,
} from '../services/reference';
import { listCartes as listCartesService } from '../services/cartes';
import { keepSelectable } from '../selectable';
import type { Category, Unite, ModePaiement, Activite, Carte } from '../types';

export const listCategories = listCategoriesService;
export const listModesPaiement = listModesPaiementService;

export async function listUnites(): Promise<Unite[]> {
  const { groupId } = await getCurrentContext();
  return listUnitesService({ groupId });
}

export async function listActivites(): Promise<Activite[]> {
  const { groupId } = await getCurrentContext();
  return listActivitesService({ groupId });
}

export async function listCartes(): Promise<Carte[]> {
  const { groupId } = await getCurrentContext();
  return listCartesService({ groupId });
}

export async function getTopCategoryIds(limit = 5): Promise<string[]> {
  const { groupId } = await getCurrentContext();
  return getTopCategoryIdsForGroupService({ groupId }, limit);
}

// === Variantes "saisie" ===
//
// Filtrent les référentiels non-mappés Comptaweb (comptaweb_id IS NULL)
// pour les dropdowns des formulaires. Une éventuelle valeur courante
// orpheline (cas écriture historique) est conservée pour ne pas la
// perdre à l'édition.

export async function listSelectableUnites(currentId?: string | null): Promise<Unite[]> {
  const all = await listUnites();
  return keepSelectable(all, currentId ?? null);
}

export async function listSelectableActivites(currentId?: string | null): Promise<Activite[]> {
  const all = await listActivites();
  return keepSelectable(all, currentId ?? null);
}

export async function listSelectableModesPaiement(currentId?: string | null): Promise<ModePaiement[]> {
  const all = await listModesPaiement();
  return keepSelectable(all, currentId ?? null);
}

export async function listSelectableCategories(currentId?: string | null): Promise<Category[]> {
  const all = await listCategories();
  return keepSelectable(all, currentId ?? null);
}

export async function listSelectableCartes(currentId?: string | null): Promise<Carte[]> {
  const all = await listCartes();
  return keepSelectable(all, currentId ?? null);
}

export type { Category, ModePaiement };
