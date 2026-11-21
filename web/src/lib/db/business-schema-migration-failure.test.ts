// #55 — si la migration échoue après sa première étape, rien n'est perdu :
// ecritures et toutes les lignes qui la référencent sont intactes, et le
// passage suivant (sans panne) aboutit. Libsql distant simulé : FK actives,
// PRAGMA foreign_keys = OFF sans effet.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { migrateEcrituresTransfertInterne } from './business-schema';

const FK_OFF = /PRAGMA\s+foreign_keys\s*=\s*(OFF|0)\s*;?/gi;
const ECRITURE = /^\s*(CREATE|ALTER|INSERT|UPDATE|DROP)\b/i;

// DbWrapper libSQL distant ; `panne` : à la 2e instruction d'écriture (la
// première a donc réussi), l'appel échoue.
function distant(db: DbWrapper, panne?: { vues: number }): DbWrapper {
  const garde = (sql: string) => {
    if (panne && ECRITURE.test(sql) && ++panne.vues >= 2) throw new Error('panne simulée après la première étape');
    return sql.replace(FK_OFF, '');
  };
  return {
    prepare: (sql) => {
      const st = db.prepare(sql.replace(FK_OFF, 'SELECT 1'));
      return {
        ...st,
        run: (...args) => {
          garde(sql);
          return st.run(...args);
        },
      };
    },
    exec: async (sql) => db.exec(garde(sql)),
    pragma: (stmt) => (/^foreign_keys\s*=\s*(OFF|0)$/i.test(stmt.trim()) ? Promise.resolve([]) : db.pragma(stmt)),
    transaction: (fn) => db.transaction((tx) => fn(distant(tx, panne))),
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
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  INSERT INTO remboursements VALUES ('R1', 'E3');
  INSERT INTO depots_especes VALUES ('DE1', 'E1'), ('DE2', 'E3');
  INSERT INTO depots_justificatifs VALUES ('D1', 'E2');
`;

let brut: DbWrapper;

async function etat(): Promise<unknown> {
  return {
    ecritures: await brut.prepare('SELECT id, description, amount_cents FROM ecritures ORDER BY id').all(),
    remboursements: await brut.prepare('SELECT * FROM remboursements ORDER BY id').all(),
    depots_especes: await brut.prepare('SELECT * FROM depots_especes ORDER BY id').all(),
    depots_justificatifs: await brut.prepare('SELECT * FROM depots_justificatifs ORDER BY id').all(),
  };
}

describe('échec après la première étape de la migration', () => {
  beforeEach(async () => {
    brut = wrapClient(createClient({ url: 'file::memory:' }));
    await brut.exec(AVANT_51);
    await brut.exec('PRAGMA foreign_keys = ON');
  });

  it('laisse tout intact, puis le passage suivant aboutit', async () => {
    const avant = await etat();

    // L'échec forcé est permis (la migration peut aussi n'avoir qu'une étape) ;
    // dans tous les cas, rien n'est perdu.
    await migrateEcrituresTransfertInterne(distant(brut, { vues: 0 })).catch(() => undefined);
    expect(await etat()).toEqual(avant);
    const fk = await brut.prepare('PRAGMA foreign_keys').get<{ foreign_keys: number }>();
    expect(fk?.foreign_keys).toBe(1);

    await expect(migrateEcrituresTransfertInterne(distant(brut))).resolves.toBeUndefined();
    expect(await etat()).toEqual(avant);
    const cols = (await brut.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>()).map((c) => c.name);
    expect(cols).toContain('mode_transfert');
    const reste = await brut.prepare("SELECT name FROM sqlite_master WHERE name = 'ecritures_new'").get();
    expect(reste).toBeUndefined();
  });
});
