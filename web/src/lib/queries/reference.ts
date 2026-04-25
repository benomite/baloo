import { getCurrentContext } from '../context';
import {
  listCategories as listCategoriesService,
  listModesPaiement as listModesPaiementService,
  listUnites as listUnitesService,
  listActivites as listActivitesService,
} from '../services/reference';

export const listCategories = listCategoriesService;
export const listModesPaiement = listModesPaiementService;

export function listUnites() {
  return listUnitesService({ groupId: getCurrentContext().groupId });
}

export function listActivites() {
  return listActivitesService({ groupId: getCurrentContext().groupId });
}
