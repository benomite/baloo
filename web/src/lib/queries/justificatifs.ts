import { getCurrentContext } from '../context';
import { listJustificatifs as listJustificatifsService } from '../services/justificatifs';
import type { Justificatif } from '../types';

export async function listJustificatifs(entityType: string, entityId: string): Promise<Justificatif[]> {
  const { groupId } = await getCurrentContext();
  return listJustificatifsService({ groupId }, { entity_type: entityType, entity_id: entityId });
}
