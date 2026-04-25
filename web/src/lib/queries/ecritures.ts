import { getCurrentContext } from '../context';
import {
  listEcritures as listEcrituresService,
  getEcriture as getEcritureService,
  computeMissingFields as computeMissingFieldsService,
  type EcritureFilters,
} from '../services/ecritures';
import type { Ecriture } from '../types';

export type { EcritureFilters };

export const computeMissingFields = computeMissingFieldsService;

export function listEcritures(filters: EcritureFilters = {}): { ecritures: Ecriture[]; total: number } {
  return listEcrituresService({ groupId: getCurrentContext().groupId }, filters);
}

export function getEcriture(id: string): Ecriture | undefined {
  return getEcritureService({ groupId: getCurrentContext().groupId }, id);
}
