// Import des transferts inter-structures (hors résultat) comme lignes validées.
// Promotion d'un draft matchant (adopte le titre CW + cat-flux-structures) ;
// sinon création ; dédup par contenu contre les écritures non-draft.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let idc = 0;
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-NEW-${++idc}`,
  currentTimestamp: () => '2026-07-03T10:00:00Z',
}));

import { importHorsResultatTransfers } from '../hors-resultat-import';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, category_id TEXT, status TEXT,
      comptaweb_synced INTEGER DEFAULT 0, comptaweb_ecriture_id INTEGER,
      justif_attendu INTEGER DEFAULT 1, updated_at TEXT, created_at TEXT
    );
  `);
  return db;
}

const TRANSFER = {
  cwId: 2403659,
  dateEcriture: '2026-06-01',
  montantCentimes: -15900,
  intitule: 'Regroupement de 2 prélèvements nationaux du 01/06/2026 pour la structure',
};

describe('importHorsResultatTransfers', () => {
  beforeEach(() => { idc = 0; });

  it('promeut un draft matchant en ligne validée (titre CW + cat-flux-structures)', async () => {
    const db = await setup();
    await db.prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status)
       VALUES ('ECR-368', 'g', '2026-06-03', 'PRLV SEPA/SCOUTS ET GUIDES DE F ...', 15900, 'depense', 'draft')`,
    ).run();

    const res = await importHorsResultatTransfers(db, { groupId: 'g' }, [TRANSFER]);

    expect(res).toEqual({ promoted: 1, created: 0, skipped: 0 });
    const e = await db.prepare(
      'SELECT status, description, category_id, comptaweb_ecriture_id, comptaweb_synced FROM ecritures WHERE id = ?',
    ).get('ECR-368');
    expect(e).toMatchObject({
      status: 'mirror',
      description: TRANSFER.intitule,
      category_id: 'cat-flux-structures',
      comptaweb_ecriture_id: 2403659,
      comptaweb_synced: 1,
    });
  });

  it('crée une ligne validée quand aucun draft ne matche', async () => {
    const db = await setup();
    const res = await importHorsResultatTransfers(db, { groupId: 'g' }, [TRANSFER]);
    expect(res).toEqual({ promoted: 0, created: 1, skipped: 0 });
    const e = await db.prepare(
      'SELECT status, type, amount_cents, category_id FROM ecritures WHERE comptaweb_ecriture_id = 2403659',
    ).get();
    expect(e).toMatchObject({ status: 'mirror', type: 'depense', amount_cents: 15900, category_id: 'cat-flux-structures' });
  });

  it('ne ré-importe pas un transfert déjà mirroré (dédup par contenu, pas par id)', async () => {
    const db = await setup();
    await db.prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, comptaweb_ecriture_id, comptaweb_synced)
       VALUES ('ECR-X', 'g', '2026-06-01', 'déjà là', 15900, 'depense', 'mirror', 999999, 1)`,
    ).run();
    const res = await importHorsResultatTransfers(db, { groupId: 'g' }, [TRANSFER]);
    expect(res).toEqual({ promoted: 0, created: 0, skipped: 1 });
    const n = await db.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});
