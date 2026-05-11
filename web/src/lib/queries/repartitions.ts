import { getCurrentContext } from '../context';
import {
  listRepartitions as listRepartitionsService,
  getRepartitionsNetByUnite as getRepartitionsNetByUniteService,
  type Repartition,
  type ListRepartitionsOptions,
} from '../services/repartitions';

export type { Repartition, ListRepartitionsOptions };

export async function listRepartitions(options: ListRepartitionsOptions = {}): Promise<Repartition[]> {
  const { groupId } = await getCurrentContext();
  return listRepartitionsService({ groupId }, options);
}

export async function getRepartitionsNetByUnite(saison: string): Promise<Record<string, number>> {
  const { groupId } = await getCurrentContext();
  return getRepartitionsNetByUniteService({ groupId }, saison);
}
