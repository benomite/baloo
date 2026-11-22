// Critère 4 (#61) : un outil MCP liste les mouvements de caisse Baloo-only
// existants, qui ne sont ni brouillons ni miroirs de Comptaweb.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';
import { registerAllTools } from '../../register-all';
import { captureTools, parseToolResult } from './test-helpers';

let testDb: DbWrapper;
vi.mock('../../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../db')>();
  return { ...actual, getDb: () => testDb };
});

const EXISTANTS = ['create_mouvement_caisse', 'cw_sync_caisse', 'cw_list_caisses', 'list_mouvements_caisse'];
const NOM_LISTE = /(baloo|orphelin|local|sans_?cw|non_?rapproch|non_?miroir|a_?regulariser|a_?resoudre|heritage|legacy)/;

describe('liste des mouvements de caisse Baloo-only (#61)', () => {
  beforeEach(async () => {
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    testDb = wrapClient(client);
    await testDb.exec(`
      CREATE TABLE mouvements_caisse (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_mouvement TEXT NOT NULL,
        description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT, numero_piece TEXT,
        status TEXT NOT NULL DEFAULT 'saisi', depot_id TEXT, airtable_id TEXT,
        comptaweb_ecriture_id INTEGER, archived_at TEXT, solde_apres_cents INTEGER,
        unite_id TEXT, activite_id TEXT, notes TEXT,
        created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z'
      );
      INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, status, comptaweb_ecriture_id)
      VALUES ('CAI-ORPH', 'g-test', '2026-09-01', 'Ancienne saisie', 1000, 'saisi', NULL),
             ('CAI-DRAFT', 'g-test', '2026-09-02', 'Brouillon', -200, 'draft', NULL),
             ('CAI-MIRROR', 'g-test', '2026-09-03', 'Miroir', -300, 'rapproche', 777);
    `);
  });

  it('renvoie le mouvement Baloo-only, sans brouillon ni miroir', async () => {
    const tools = captureTools(registerAllTools);
    const nom = Object.keys(tools).find(
      (n) => /caisse/.test(n) && !EXISTANTS.includes(n) && NOM_LISTE.test(n) && /^(list|lister)/.test(n),
    );
    expect(nom, 'un outil list_* de mouvements de caisse Baloo-only').toBeTruthy();
    const out = JSON.stringify(parseToolResult(await tools[nom!].handler({})));
    expect(out).toContain('CAI-ORPH');
    expect(out).not.toContain('CAI-DRAFT');
    expect(out).not.toContain('CAI-MIRROR');
  });
});
