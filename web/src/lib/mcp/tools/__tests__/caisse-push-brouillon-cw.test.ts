// Critère 3 (#61) : un outil MCP envoie un brouillon de caisse validé vers
// Comptaweb ; au sync_run suivant ce mouvement est reconnu comme la ligne CW
// et il n'existe aucun doublon.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';
import { persistCaisseSync } from '../../../services/caisse-sync';
import { registerAllTools } from '../../register-all';
import { captureTools } from './test-helpers';

let testDb: DbWrapper;
vi.mock('../../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../db')>();
  return { ...actual, getDb: () => testDb };
});

const EXISTANTS = ['create_mouvement_caisse', 'cw_sync_caisse', 'cw_list_caisses', 'list_mouvements_caisse'];

describe('envoi d’un brouillon de caisse vers Comptaweb (#61)', () => {
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
    `);
  });

  it('un outil MCP expose l’envoi d’un brouillon de caisse vers Comptaweb', () => {
    const tools = captureTools(registerAllTools);
    const push = Object.keys(tools).filter(
      (n) => /caisse/.test(n) && !EXISTANTS.includes(n) && /(push|envoy|send|cw_|comptaweb|valider)/.test(n),
    );
    expect(push.length).toBeGreaterThan(0);
  });

  it('après envoi, le sync suivant reconnaît la ligne CW : aucun doublon', async () => {
    await testDb
      .prepare(
        `INSERT INTO mouvements_caisse
           (id, group_id, date_mouvement, description, amount_cents, type, numero_piece, status)
         VALUES ('CAI-2026-001', 'g1', '2026-10-05', 'Achat fournitures', -800, 'sortie', 'CAI-2026-001', 'pending_sync')`,
      )
      .run();

    await persistCaisseSync('g1', {
      caisseId: 1,
      libelle: 'Caisse principale',
      soldeDebutCentimes: 0,
      depensesCentimes: 800,
      recettesCentimes: 0,
      soldeCentimes: -800,
      mouvements: [
        {
          comptawebEcritureId: 9001,
          date: '2026-10-05',
          type: 'depense',
          montantCentimes: 800,
          intitule: 'Achat fournitures',
          numeroPiece: 'CAI-2026-001',
          categorieTiers: null,
        },
      ],
    });

    const rows = await testDb
      .prepare('SELECT id, status, comptaweb_ecriture_id FROM mouvements_caisse')
      .all<{ id: string; status: string; comptaweb_ecriture_id: number | null }>();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('CAI-2026-001');
    expect(rows[0].comptaweb_ecriture_id).toBe(9001);
    expect(rows[0].status).not.toBe('pending_sync');
  });
});
