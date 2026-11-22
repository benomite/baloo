import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../db';
import { nextIdOn } from '../ids';

// #61 : sur une BDD minimale (tables absentes), l'id suit le max des tables
// présentes — pas seulement `ecritures` (un mouvement de caisse se crée sans).
describe('nextIdOn — repli table par table', () => {
  it('prend le max des tables présentes quand l’union échoue', async () => {
    const client = createClient({ url: 'file::memory:' });
    await client.executeMultiple(`
      CREATE TABLE mouvements_caisse (id TEXT PRIMARY KEY);
      INSERT INTO mouvements_caisse VALUES ('CAI-2026-004'), ('CAI-2026-002'), ('CAI-2025-009');
      CREATE TABLE justificatifs (id TEXT PRIMARY KEY);
      INSERT INTO justificatifs VALUES ('CAI-2026-003');
    `);
    const db = wrapClient(client);
    expect(await nextIdOn(db, 'CAI', { year: 2026 })).toBe('CAI-2026-005');
    expect(await nextIdOn(db, 'CAI', { year: 2027 })).toBe('CAI-2027-001');
  });
});
