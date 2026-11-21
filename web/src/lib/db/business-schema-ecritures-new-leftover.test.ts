// #55 — en production, les tentatives échouées ont laissé une table
// `ecritures_new`. La migration doit la détecter, s'en débarrasser (ou la
// réutiliser) sans perdre une écriture, et n'en laisser aucune derrière elle,
// sur libSQL distant (FK actives, PRAGMA foreign_keys = OFF sans effet).

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { migrateEcrituresTransfertInterne } from './business-schema';

const FK_OFF = /PRAGMA\s+foreign_keys\s*=\s*(OFF|0)\s*;?/gi;

// DbWrapper qui se comporte comme libSQL distant : désactiver les FK est sans effet.
function distant(db: DbWrapper): DbWrapper {
  return {
    prepare: (sql) => db.prepare(sql.replace(FK_OFF, 'SELECT 1')),
    exec: (sql) => db.exec(sql.replace(FK_OFF, '')),
    pragma: (stmt) => (/^foreign_keys\s*=\s*(OFF|0)$/i.test(stmt.trim()) ? Promise.resolve([]) : db.pragma(stmt)),
    transaction: (fn) => db.transaction((tx) => fn(distant(tx))),
  };
}

const AVANT_51 = `
  CREATE TABLE unites (id TEXT PRIMARY KEY);
  CREATE TABLE categories (id TEXT PRIMARY KEY);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY);
  CREATE TABLE activites (id TEXT PRIMARY KEY);
  CREATE TABLE cartes (id TEXT PRIMARY KEY);
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('depense', 'recette')),
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT
  );
  INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type) VALUES
    ('E1', 'g1', '2026-10-03', 'Versement', 25000, 'recette'),
    ('E2', 'g1', '2026-10-04', 'Achat', 1200, 'depense'),
    ('E3', 'g1', '2026-10-05', 'Remboursement', 800, 'depense');
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  INSERT INTO remboursements VALUES ('R1', 'E3');
  INSERT INTO depots_especes VALUES ('DE1', 'E1'), ('DE2', 'E3');
`;

let brut: DbWrapper;

async function ids(): Promise<string[]> {
  return (await brut.prepare('SELECT id FROM ecritures ORDER BY id').all<{ id: string }>()).map((r) => r.id);
}

async function ecrituresNew(): Promise<unknown> {
  return brut.prepare("SELECT name FROM sqlite_master WHERE name = 'ecritures_new'").get();
}

describe('ecritures_new laissée par une tentative échouée', () => {
  beforeEach(async () => {
    brut = wrapClient(createClient({ url: 'file::memory:' }));
    await brut.exec(AVANT_51);
    await brut.exec('PRAGMA foreign_keys = ON');
  });

  it('table vide : la migration aboutit, aucune écriture perdue, plus d’ecritures_new', async () => {
    await brut.exec('CREATE TABLE ecritures_new (id TEXT PRIMARY KEY, group_id TEXT)');
    await migrateEcrituresTransfertInterne(distant(brut));

    expect(await ids()).toEqual(['E1', 'E2', 'E3']);
    expect(await ecrituresNew()).toBeUndefined();
    const cols = (await brut.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>()).map((c) => c.name);
    expect(cols).toContain('mode_transfert');
    const dep = await brut.prepare('SELECT COUNT(*) AS n FROM depots_especes').get<{ n: number }>();
    expect(dep?.n).toBe(2);
  });

  it('table non vide : la migration aboutit, aucune écriture perdue, plus d’ecritures_new', async () => {
    await brut.exec(`
      CREATE TABLE ecritures_new (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_ecriture TEXT NOT NULL, description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', notes TEXT
      );
      INSERT INTO ecritures_new SELECT * FROM ecritures WHERE id IN ('E1', 'E2');
    `);
    await migrateEcrituresTransfertInterne(distant(brut));

    expect(await ids()).toEqual(['E1', 'E2', 'E3']);
    expect(await ecrituresNew()).toBeUndefined();
    const e3 = await brut.prepare("SELECT description, amount_cents FROM ecritures WHERE id = 'E3'").get();
    expect(e3).toEqual({ description: 'Remboursement', amount_cents: 800 });
    const rb = await brut.prepare('SELECT ecriture_id FROM remboursements WHERE id = ?').get('R1');
    expect(rb).toEqual({ ecriture_id: 'E3' });
  });
});
