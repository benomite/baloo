// Critère 2 (#51) : pour un dépôt d'espèces, le brouillon « Transfert interne »
// se lie à un dépôt existant de la caisse, ou crée ce dépôt à partir du
// brouillon. Caisse et brouillon montrent ensuite la même opération (même
// montant, même date).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { createDepotEspecesAvecMouvement } from '../caisse';
import {
  attachDepotEspecesToEcriture,
  listCandidateEcrituresForDepot,
  getDepotEspeces,
} from '../depots-especes';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

describe('Transfert interne — dépôt d’espèces et caisse', () => {
  beforeEach(async () => {
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    testDb = wrapClient(client);
    await testDb.exec(`
      CREATE TABLE ecritures (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_ecriture TEXT NOT NULL,
        description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
        mode_transfert TEXT, numero_piece TEXT, status TEXT NOT NULL DEFAULT 'draft'
      );
      CREATE TABLE depots_especes (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_depot TEXT NOT NULL,
        total_amount_cents INTEGER NOT NULL, detail_billets TEXT, ecriture_id TEXT,
        airtable_id TEXT, notes TEXT, archived_at TEXT,
        created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z'
      );
      CREATE TABLE mouvements_caisse (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_mouvement TEXT NOT NULL,
        description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT, numero_piece TEXT,
        status TEXT NOT NULL DEFAULT 'saisi', depot_id TEXT, airtable_id TEXT,
        comptaweb_ecriture_id INTEGER, archived_at TEXT, solde_apres_cents INTEGER,
        unite_id TEXT, activite_id TEXT, notes TEXT,
        created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z'
      );
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, mode_transfert)
      VALUES ('E1', 'g1', '2026-10-03', 'VERSEMENT ESPECES', 25000, 'transfert_interne', 'depot_especes');
    `);
  });

  it('propose le brouillon comme candidat et le lie à un dépôt existant', async () => {
    const { depot } = await createDepotEspecesAvecMouvement(
      { groupId: 'g1' },
      { date_depot: '2026-10-03', total_amount_cents: 25000 },
    );

    const candidats = await listCandidateEcrituresForDepot(
      { groupId: 'g1' },
      { amount_cents: 25000, date: '2026-10-03' },
    );
    expect(candidats.map((c) => c.id)).toContain('E1');

    const lie = await attachDepotEspecesToEcriture({ groupId: 'g1' }, depot.id, 'E1');
    expect(lie.ecriture_id).toBe('E1');
  });

  it('crée le dépôt depuis le brouillon : même montant, même date, lié', async () => {
    const { depot, mouvement } = await createDepotEspecesAvecMouvement(
      { groupId: 'g1' },
      { date_depot: '2026-10-03', total_amount_cents: 25000, ecriture_id: 'E1' } as never,
    );

    const relu = await getDepotEspeces({ groupId: 'g1' }, depot.id);
    expect(relu?.ecriture_id).toBe('E1');
    expect(relu?.total_amount_cents).toBe(25000);
    expect(relu?.date_depot).toBe('2026-10-03');
    expect(Math.abs(mouvement.amount_cents)).toBe(25000);
    expect(mouvement.date_mouvement).toBe('2026-10-03');
    expect(mouvement.status).toBe('rapproche');
  });
});
