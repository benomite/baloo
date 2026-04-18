import { getDb } from '../db';
import type { Justificatif } from '../types';

export function listJustificatifs(entityType: string, entityId: string): Justificatif[] {
  return getDb().prepare(
    'SELECT * FROM justificatifs WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC'
  ).all(entityType, entityId) as Justificatif[];
}
