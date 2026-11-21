// #55 — la migration est idempotente (le second passage ne change rien :
// schéma et données identiques) et aucune de ses instructions ne supprime la
// table ecritures peuplée. Libsql distant simulé : FK actives, PRAGMA
// foreign_keys = OFF sans effet.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { migrateEcrituresTransfertInterne } from './business-schema';

const FK_OFF = /PRAGMA\s+foreign_keys\s*=\s*(OFF|0)\s*;?/gi;
const DROP_ECRITURES = /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?[`"'[]?ecritures[`"'\]]?\s*(;|$)/im;

// DbWrapper libSQL distant qui enregistre toutes les instructions envoyées.
function distant(db: DbWrapper, journal: string[]): DbWrapper {
  return {
    prepare: (sql) => {
      journal.push(sql);
      return db.prepare(sql.replace(FK_OFF, 'SELECT 1'));
    },
    exec: (sql) => {
      journal.push(sql);
      return db.exec(sql.replace(FK_OFF, ''));
    },
    pragma: (stmt) => {
      journal.push(`PRAGMA ${stmt}`);
      return /^foreign_keys\s*=\s*(OFF|0)$/i.test(stmt.trim()) ? Promise.resolve([]) : db.pragma(stmt);
    },
    transaction: (fn) => db.transaction((tx) => fn(distant(tx, journal))),
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
  CREATE INDEX idx_ecritures_group ON ecritures(group_id);
  INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type) VALUES
    ('E1', 'g1', '2026-10-03', 'Versement', 25000, 'recette'),
    ('E2', 'g1', '2026-10-04', 'Achat', 1200, 'depense');
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  INSERT INTO remboursements VALUES ('R1', 'E2');
  INSERT INTO depots_especes VALUES ('DE1', 'E1');
`;

let brut: DbWrapper;

async function instantane(): Promise<unknown> {
  return {
    schema: await brut.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all(),
    ecritures: await brut.prepare('SELECT * FROM ecritures ORDER BY id').all(),
    remboursements: await brut.prepare('SELECT * FROM remboursements ORDER BY id').all(),
    depots_especes: await brut.prepare('SELECT * FROM depots_especes ORDER BY id').all(),
  };
}

describe('migration transfert interne : idempotence et absence de DROP ecritures', () => {
  beforeEach(async () => {
    brut = wrapClient(createClient({ url: 'file::memory:' }));
    await brut.exec(AVANT_51);
    await brut.exec('PRAGMA foreign_keys = ON');
  });

  it('un second passage ne change rien, et aucune instruction ne supprime ecritures', async () => {
    const journal: string[] = [];
    await migrateEcrituresTransfertInterne(distant(brut, journal));
    const apresPremier = await instantane();
    const cols = (await brut.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>()).map((c) => c.name);
    expect(cols).toContain('mode_transfert');

    await migrateEcrituresTransfertInterne(distant(brut, journal));
    expect(await instantane()).toEqual(apresPremier);

    expect(journal.filter((sql) => DROP_ECRITURES.test(sql))).toEqual([]);
  });
});
