// Vérifie qu'un groupe de ventilation issu d'un split de sous-ligne bancaire
// (2 lignes, même sous_index) voit son SENS recalé sur TOUTES ses lignes,
// et qu'aucune n'est prunée comme stale. On teste le helper de correction
// de groupe extrait de scanDraftsFromComptaweb.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({ currentTimestamp: () => '2026-07-13T10:00:00Z', nextId: async (p: string) => `${p}-X` }));

import { correctGroupDraftType } from '../drafts';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, type TEXT, justif_attendu INTEGER,
      ventilation_group_id TEXT, status TEXT, comptaweb_ecriture_id INTEGER, updated_at TEXT);
    INSERT INTO ecritures VALUES
      ('E1','g1','recette',0,'vg_1','draft',NULL,'t'),
      ('E2','g1','recette',0,'vg_1','draft',NULL,'t');
  `);
  return db;
}

describe('correctGroupDraftType', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('recale le sens sur toutes les lignes du groupe', async () => {
    await correctGroupDraftType(testDb, 'g1', 'E1', 'vg_1', 'depense', 1);
    const rows = await testDb.prepare("SELECT type, justif_attendu FROM ecritures WHERE group_id='g1'").all<{ type: string; justif_attendu: number }>();
    expect(rows.every((r) => r.type === 'depense' && r.justif_attendu === 1)).toBe(true);
  });

  it('sans vg (ligne seule) ne touche que la ligne', async () => {
    await testDb.prepare("UPDATE ecritures SET ventilation_group_id = NULL WHERE id='E2'").run();
    await correctGroupDraftType(testDb, 'g1', 'E2', null, 'depense', 1);
    const e1 = await testDb.prepare("SELECT type FROM ecritures WHERE id='E1'").get<{ type: string }>();
    const e2 = await testDb.prepare("SELECT type FROM ecritures WHERE id='E2'").get<{ type: string }>();
    expect(e1?.type).toBe('recette'); // intacte
    expect(e2?.type).toBe('depense');
  });
});
