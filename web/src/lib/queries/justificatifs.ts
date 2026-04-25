import { getCurrentContext } from '../context';
import { listJustificatifs as listJustificatifsService } from '../services/justificatifs';
import type { Justificatif } from '../types';

export function listJustificatifs(entityType: string, entityId: string): Justificatif[] {
  return listJustificatifsService(
    { groupId: getCurrentContext().groupId },
    { entity_type: entityType, entity_id: entityId },
  );
}
