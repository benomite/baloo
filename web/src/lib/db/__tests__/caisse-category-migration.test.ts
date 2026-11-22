// #62 — colonne `mouvements_caisse.category_id` sur une BDD déjà déployée
// (CREATE TABLE IF NOT EXISTS y est un no-op) : ajoutée par ALTER, une fois.
import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';
import { migrateCaisseCategoryColumn } from '../../auth/schema';

describe('migration mouvements_caisse.category_id', () => {
  it('ajoute la colonne sur une table historique, idempotent', async () => {
    const db = wrapClient(createClient({ url: 'file::memory:' }));
    await db.exec(
      'CREATE TABLE mouvements_caisse (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, description TEXT NOT NULL)',
    );
    await migrateCaisseCategoryColumn(db);
    await migrateCaisseCategoryColumn(db);
    const cols = await db.prepare('PRAGMA table_info(mouvements_caisse)').all<{ name: string }>();
    expect(cols.filter((c) => c.name === 'category_id')).toHaveLength(1);
  });
});
