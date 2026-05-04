import { getCurrentContext } from '../context';
import {
  listCategories as listCategoriesService,
  listModesPaiement as listModesPaiementService,
  listUnites as listUnitesService,
  listActivites as listActivitesService,
  getTopCategoryIdsForGroup as getTopCategoryIdsForGroupService,
} from '../services/reference';
import { listCartes as listCartesService } from '../services/cartes';
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

export type { Category, ModePaiement };
