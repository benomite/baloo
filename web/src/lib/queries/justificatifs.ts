import { getCurrentContext } from '../context';
import {
  listJustificatifs as listJustificatifsService,
  listJustificatifsForEcriture as listJustificatifsForEcritureService,
  type EcritureJustifsBundle,
} from '../services/justificatifs';
import type { Justificatif } from '../types';

export type { EcritureJustifsBundle };

export async function listJustificatifs(entityType: string, entityId: string): Promise<Justificatif[]> {
  const { groupId } = await getCurrentContext();
  return listJustificatifsService({ groupId }, { entity_type: entityType, entity_id: entityId });
}

export async function listJustificatifsForEcriture(ecritureId: string): Promise<EcritureJustifsBundle> {
  const { groupId } = await getCurrentContext();
  return listJustificatifsForEcritureService({ groupId }, ecritureId);
}
