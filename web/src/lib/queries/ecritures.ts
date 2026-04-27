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

export async function listEcritures(filters: EcritureFilters = {}): Promise<{ ecritures: Ecriture[]; total: number }> {
  const { groupId, scopeUniteId } = await getCurrentContext();
  return listEcrituresService({ groupId, scopeUniteId }, filters);
}

export async function getEcriture(id: string): Promise<Ecriture | undefined> {
  const { groupId, scopeUniteId } = await getCurrentContext();
  return getEcritureService({ groupId, scopeUniteId }, id);
}
