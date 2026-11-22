// Critère 5 (#61) : pour chaque mouvement de caisse Baloo-only, un outil MCP
// l'envoie à Comptaweb ou le rapproche d'une ligne de caisse CW choisie par
// l'utilisateur. Aucun mouvement n'est supprimé.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';
import { registerAllTools } from '../../register-all';
import { captureTools } from './test-helpers';

let testDb: DbWrapper;
vi.mock('../../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../db')>();
  return { ...actual, getDb: () => testDb };
});

const EXISTANTS = ['create_mouvement_caisse', 'cw_sync_caisse', 'cw_list_caisses', 'list_mouvements_caisse'];

describe('résolution des mouvements de caisse Baloo-only (#61)', () => {
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
      INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, status)
      VALUES ('CAI-ORPH', 'g-test', '2026-09-01', 'Ancienne saisie', 1000, 'saisi');
    `);
  });

  it('un outil envoie le mouvement à Comptaweb, un autre le rapproche d’une ligne CW', () => {
    const tools = captureTools(registerAllTools);
    const noms = Object.keys(tools).filter((n) => /caisse/.test(n) && !EXISTANTS.includes(n));
    const rapproche = noms.filter((n) => /(match|rapproch|lier|link|associ)/.test(n));
    const envoie = noms.filter((n) => /(push|envoy|send|cw_|comptaweb)/.test(n));
    expect(rapproche.length).toBeGreaterThan(0);
    expect(envoie.length).toBeGreaterThan(0);
  });

  it('le rapprochement lie le mouvement à la ligne CW choisie sans le supprimer', async () => {
    const tools = captureTools(registerAllTools);
    const nom = Object.keys(tools).find(
      (n) => /caisse/.test(n) && !EXISTANTS.includes(n) && /(match|rapproch|lier|link|associ)/.test(n),
    );
    expect(nom, 'un outil de rapprochement de mouvement de caisse').toBeTruthy();

    const input: Record<string, unknown> = {};
    for (const cle of Object.keys(tools[nom!].schema)) {
      if (/(cw|comptaweb)/i.test(cle)) input[cle] = 4242;
      else if (/(mouvement|id)/i.test(cle)) input[cle] = 'CAI-ORPH';
    }
    await tools[nom!].handler(input);

    const row = await testDb
      .prepare('SELECT comptaweb_ecriture_id FROM mouvements_caisse WHERE id = ?')
      .get<{ comptaweb_ecriture_id: number | null }>('CAI-ORPH');
    expect(row).toBeTruthy();
    expect(row?.comptaweb_ecriture_id).toBe(4242);
  });

  it('aucun outil de caisse ne supprime de mouvement', () => {
    const tools = captureTools(registerAllTools);
    expect(Object.keys(tools).filter((n) => /(delete|supprim|remove)/.test(n) && /caisse/.test(n))).toEqual([]);
  });
});
