import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../db';
import { migrateMouvementsCaisseCategory } from './schema';

// #61 : la nature d'un mouvement de caisse, requise pour l'envoi à Comptaweb.
describe('migrateMouvementsCaisseCategory', () => {
  it('ajoute category_id à une table legacy, sans toucher aux lignes, et reste idempotente', async () => {
    const client = createClient({ url: 'file::memory:' });
    await client.executeMultiple(`
      CREATE TABLE mouvements_caisse (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, amount_cents INTEGER NOT NULL);
      INSERT INTO mouvements_caisse VALUES ('CAI-1', 'g1', 100);
    `);
    const db = wrapClient(client);
    await migrateMouvementsCaisseCategory(db);
    await migrateMouvementsCaisseCategory(db);
    const cols = await db.prepare('PRAGMA table_info(mouvements_caisse)').all<{ name: string }>();
    expect(cols.filter((c) => c.name === 'category_id')).toHaveLength(1);
    expect(await db.prepare('SELECT id, category_id FROM mouvements_caisse').all()).toEqual([
      { id: 'CAI-1', category_id: null },
    ]);
  });
});
