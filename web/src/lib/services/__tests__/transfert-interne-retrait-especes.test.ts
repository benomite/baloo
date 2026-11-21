// Critère 3 (#51) : pour un retrait d'espèces (banque → caisse), le brouillon
// « Transfert interne » se lie à un retrait existant de la caisse, ou crée ce
// retrait depuis le brouillon. Sens inverse du dépôt : le mouvement de caisse
// est une entrée (montant positif).
//
// Contrat : `createRetraitEspecesAvecMouvement` (services/caisse), symétrique de
// `createDepotEspecesAvecMouvement`, accepte `ecriture_id` ; le retrait créé
// porte le même montant et la même date que le brouillon.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import * as caisse from '../caisse';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

describe('Transfert interne — retrait d’espèces et caisse', () => {
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
      VALUES ('E2', 'g1', '2026-10-05', 'RETRAIT ESPECES', 8000, 'transfert_interne', 'retrait_especes');
    `);
  });

  it('crée le retrait depuis le brouillon : entrée en caisse, même montant et même date', async () => {
    const creer = (caisse as Record<string, unknown>).createRetraitEspecesAvecMouvement as
      | ((ctx: { groupId: string }, input: Record<string, unknown>) => Promise<{
          mouvement: { amount_cents: number; date_mouvement: string; type: string | null };
        }>)
      | undefined;
    expect(creer).toBeTypeOf('function');

    const { mouvement } = await creer!(
      { groupId: 'g1' },
      { date_retrait: '2026-10-05', total_amount_cents: 8000, ecriture_id: 'E2' },
    );
    expect(mouvement.type).toBe('retrait');
    expect(mouvement.amount_cents).toBe(8000);
    expect(mouvement.date_mouvement).toBe('2026-10-05');

    const ligne = await testDb
      .prepare("SELECT amount_cents, date_mouvement FROM mouvements_caisse WHERE type = 'retrait'")
      .get<{ amount_cents: number; date_mouvement: string }>();
    expect(ligne).toEqual({ amount_cents: 8000, date_mouvement: '2026-10-05' });
  });
});
