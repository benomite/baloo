// #55 — cas complémentaires de la migration transfert interne sans
// reconstruction : annulation complète si le lot échoue en cours de route,
// index posés sur `type` retirés puis recréés (et seulement eux), et
// `ecritures_new` laissée en place quand la retirer pourrait perdre quelque
// chose. Libsql distant simulé : FK actives, PRAGMA foreign_keys = OFF sans effet.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { migrateEcrituresTransfertInterne } from './business-schema';

const FK_OFF = /PRAGMA\s+foreign_keys\s*=\s*(OFF|0)\s*;?/gi;

// `alterer` réécrit le SQL envoyé par exec (pour injecter une panne) ;
// `journal` reçoit tout ce qui est envoyé.
function distant(db: DbWrapper, opts: { alterer?: (sql: string) => string; journal?: string[] } = {}): DbWrapper {
  return {
    prepare: (sql) => {
      opts.journal?.push(sql);
      return db.prepare(sql.replace(FK_OFF, 'SELECT 1'));
    },
    exec: (sql) => {
      opts.journal?.push(sql);
      return db.exec((opts.alterer ?? ((s) => s))(sql.replace(FK_OFF, '')));
    },
    pragma: (stmt) => (/^foreign_keys\s*=\s*(OFF|0)$/i.test(stmt.trim()) ? Promise.resolve([]) : db.pragma(stmt)),
    transaction: (fn) => db.transaction((tx) => fn(distant(tx, opts))),
  };
}

const AVANT_51 = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('depense', 'recette')),
    status TEXT NOT NULL DEFAULT 'draft'
  );
  CREATE INDEX idx_ecritures_type ON ecritures(type);
  CREATE INDEX idx_ecritures_status ON ecritures(status);
  CREATE INDEX idx_perso_group_type ON ecritures(group_id, type);
  INSERT INTO ecritures (id, group_id, description, amount_cents, type) VALUES
    ('E1', 'g1', 'Versement', 25000, 'recette'),
    ('E2', 'g1', 'Achat', 1200, 'depense');
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  INSERT INTO remboursements VALUES ('R1', 'E2');
  INSERT INTO depots_especes VALUES ('DE1', 'E1');
`;

let brut: DbWrapper;

async function etat(): Promise<unknown> {
  return {
    ecritures: await brut.prepare('SELECT id, description, amount_cents, type FROM ecritures ORDER BY id').all(),
    remboursements: await brut.prepare('SELECT * FROM remboursements ORDER BY id').all(),
    depots_especes: await brut.prepare('SELECT * FROM depots_especes ORDER BY id').all(),
  };
}

async function schema(): Promise<unknown> {
  return brut.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
}

async function indexEcritures(): Promise<string[]> {
  return (
    await brut
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ecritures' ORDER BY name")
      .all<{ name: string }>()
  ).map((r) => r.name);
}

async function tableExiste(nom: string): Promise<boolean> {
  return !!(await brut.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(nom));
}

describe('migration transfert interne sans reconstruction (#55)', () => {
  beforeEach(async () => {
    brut = wrapClient(createClient({ url: 'file::memory:' }));
    await brut.exec(AVANT_51);
    await brut.exec('PRAGMA foreign_keys = ON');
  });

  it('panne au milieu du lot (après ADD, UPDATE et DROP COLUMN) : tout est annulé, puis le passage suivant aboutit', async () => {
    const avantEtat = await etat();
    const avantSchema = await schema();

    const panne = (sql: string) =>
      sql.replace('ALTER TABLE ecritures DROP COLUMN type;', 'ALTER TABLE ecritures DROP COLUMN type; SELECT * FROM panne_simulee;');
    await expect(migrateEcrituresTransfertInterne(distant(brut, { alterer: panne }))).rejects.toThrow(/panne_simulee/);

    expect(await etat()).toEqual(avantEtat);
    expect(await schema()).toEqual(avantSchema);
    await expect(brut.prepare("UPDATE ecritures SET type = 'transfert_interne' WHERE id = 'E1'").run()).rejects.toThrow();
    const fk = await brut.prepare('PRAGMA foreign_keys').get<{ foreign_keys: number }>();
    expect(fk?.foreign_keys).toBe(1);

    await migrateEcrituresTransfertInterne(distant(brut));
    expect(await etat()).toEqual(avantEtat);
    await brut.prepare("UPDATE ecritures SET type = 'transfert_interne', mode_transfert = 'depot_especes' WHERE id = 'E1'").run();
    await expect(brut.prepare("UPDATE ecritures SET type = 'virement' WHERE id = 'E2'").run()).rejects.toThrow();
    await expect(brut.prepare("UPDATE ecritures SET type = NULL WHERE id = 'E2'").run()).rejects.toThrow();
  });

  it('recrée les index posés sur type, et ne retire que ceux-là', async () => {
    const journal: string[] = [];
    await migrateEcrituresTransfertInterne(distant(brut, { journal }));

    expect(await indexEcritures()).toEqual(
      expect.arrayContaining(['idx_ecritures_type', 'idx_ecritures_status', 'idx_perso_group_type']),
    );
    const perso = await brut.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_perso_group_type'").get();
    expect(perso).toEqual({ sql: 'CREATE INDEX idx_perso_group_type ON ecritures(group_id, type)' });
    const retires = journal.join('\n').match(/DROP INDEX "[^"]+"/g);
    expect(retires?.sort()).toEqual(['DROP INDEX "idx_ecritures_type"', 'DROP INDEX "idx_perso_group_type"']);
  });

  it('ecritures_new référencée par une autre table : conservée, la migration aboutit quand même', async () => {
    await brut.exec(`
      CREATE TABLE ecritures_new (id TEXT PRIMARY KEY);
      CREATE TABLE lien_new (id TEXT PRIMARY KEY, ref TEXT REFERENCES ecritures_new(id));
    `);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await migrateEcrituresTransfertInterne(distant(brut));
    warn.mockRestore();

    expect(await tableExiste('ecritures_new')).toBe(true);
    const cols = (await brut.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>()).map((c) => c.name);
    expect(cols).toContain('mode_transfert');
  });

  it('ecritures_new avec une ligne absente de ecritures : conservée avec sa ligne', async () => {
    await brut.exec(`
      CREATE TABLE ecritures_new (id TEXT PRIMARY KEY, description TEXT);
      INSERT INTO ecritures_new VALUES ('E1', 'copie'), ('E9', 'seulement ici');
    `);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await migrateEcrituresTransfertInterne(distant(brut));
    warn.mockRestore();

    expect(await brut.prepare('SELECT id, description FROM ecritures_new ORDER BY id').all()).toEqual([
      { id: 'E1', description: 'copie' },
      { id: 'E9', description: 'seulement ici' },
    ]);
  });

  it('ecritures_new sans colonne id mais non vide : conservée', async () => {
    await brut.exec(`
      CREATE TABLE ecritures_new (description TEXT);
      INSERT INTO ecritures_new VALUES ('quelque chose');
    `);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await migrateEcrituresTransfertInterne(distant(brut));
    warn.mockRestore();

    expect(await tableExiste('ecritures_new')).toBe(true);
  });

  it('ecritures_new réduite à la colonne id, copie de ecritures : retirée', async () => {
    await brut.exec(`
      CREATE TABLE ecritures_new (id TEXT PRIMARY KEY);
      INSERT INTO ecritures_new VALUES ('E1');
    `);
    await migrateEcrituresTransfertInterne(distant(brut));

    expect(await tableExiste('ecritures_new')).toBe(false);
    expect((await etat() as { ecritures: unknown[] }).ecritures).toHaveLength(2);
  });
});
