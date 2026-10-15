// Comptaweb renumérote ses branches/projets et ses activités à chaque exercice :
// « Groupe » vaut 904730 en 2025-2026 et 1001727 en 2026-2027. Avant ce
// correctif, la sync des référentiels matchait par comptaweb_id puis, à défaut,
// par nom SEULEMENT parmi les lignes sans comptaweb_id — donc au passage
// d'exercice elle recréait toutes les unités et activités en double (constat
// prod 2026-10-15 : « Groupe » / « Groupe » GR2, « Camps » / « Camps »...).
//
// Désormais une unité/activité locale est identifiée par son nom, et ses IDs
// Comptaweb sont tenus PAR EXERCICE dans referentiels_cw_exercice.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import {
  applyReferentielsSync,
  fusionnerDoublonsReferentiels,
  lookupReferentielCwId,
  type ReferentielsInput,
} from '../sync-referentiels-logic';

const NOW = '2026-10-15T00:00:00Z';

async function setup(): Promise<DbWrapper> {
  // Fichier temporaire, pas `file::memory:` : `db.transaction()` ouvre une
  // autre connexion, qui sur une base mémoire verrait une base vide.
  const dir = mkdtempSync(join(tmpdir(), 'refs-exercice-'));
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  await client.execute('PRAGMA foreign_keys = ON');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE unites (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      comptaweb_id INTEGER, couleur TEXT, branche TEXT, created_at TEXT NOT NULL);
    CREATE TABLE activites (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL,
      comptaweb_id INTEGER, created_at TEXT NOT NULL);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, type TEXT, comptaweb_nature TEXT,
      comptaweb_id INTEGER, created_at TEXT);
    CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT, comptaweb_id INTEGER, created_at TEXT);
    CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, type TEXT, porteur TEXT, comptaweb_id INTEGER,
      code_externe TEXT, statut TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE referentiels_cw_exercice (kind TEXT NOT NULL, local_id TEXT NOT NULL, exercice TEXT NOT NULL,
      group_id TEXT NOT NULL, comptaweb_id INTEGER NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (kind, local_id, exercice));
    CREATE TABLE ecritures (id TEXT PRIMARY KEY, unite_id TEXT REFERENCES unites(id),
      activite_id TEXT REFERENCES activites(id));
    CREATE TABLE user_unites (user_id TEXT NOT NULL, unite_id TEXT NOT NULL REFERENCES unites(id),
      PRIMARY KEY (user_id, unite_id));
  `);
  return db;
}

function refs(
  branches: Array<[number, string]>,
  activites: Array<[number, string]>,
): ReferentielsInput {
  return {
    brancheprojet: branches.map(([v, l]) => ({ value: String(v), label: l })),
    activite: activites.map(([v, l]) => ({ value: String(v), label: l })),
    nature: [],
    modetransaction: [],
    cartes: [],
  };
}

async function compte(db: DbWrapper, table: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get<{ n: number }>();
  return r?.n ?? 0;
}

describe('applyReferentielsSync — IDs Comptaweb par exercice', () => {
  it("ne duplique pas unités et activités quand l'exercice suivant les renumérote", async () => {
    const db = await setup();

    await applyReferentielsSync(db, 'g1', refs([[904730, 'Groupe']], [[904729, 'Camps']]), NOW, '2025-2026');
    const r = await applyReferentielsSync(
      db,
      'g1',
      refs([[1001727, 'Groupe']], [[1001726, 'Camps']]),
      NOW,
      '2026-2027',
    );

    expect(await compte(db, 'unites')).toBe(1);
    expect(await compte(db, 'activites')).toBe(1);
    expect(r.unites.ajoutees).toBe(0);
    expect(r.activites.ajoutees).toBe(0);

    const u = await db.prepare('SELECT id FROM unites').get<{ id: string }>();
    const a = await db.prepare('SELECT id FROM activites').get<{ id: string }>();
    expect(await lookupReferentielCwId(db, 'unite', u!.id, '2025-2026')).toBe(904730);
    expect(await lookupReferentielCwId(db, 'unite', u!.id, '2026-2027')).toBe(1001727);
    expect(await lookupReferentielCwId(db, 'activite', a!.id, '2025-2026')).toBe(904729);
    expect(await lookupReferentielCwId(db, 'activite', a!.id, '2026-2027')).toBe(1001726);
  });

  it("rattache par nom une unité historique déjà mappée (comptaweb_id d'un autre exercice)", async () => {
    const db = await setup();
    await db.exec(`
      INSERT INTO unites (id, group_id, code, name, comptaweb_id, created_at)
        VALUES ('u-gr', 'g1', 'GR', 'Groupe', 904730, '2026-01-01');
      INSERT INTO activites (id, group_id, name, comptaweb_id, created_at)
        VALUES ('a-camps', 'g1', 'Camps', 904729, '2026-01-01');
    `);

    await applyReferentielsSync(db, 'g1', refs([[1001727, 'Groupe']], [[1001726, 'Camps']]), NOW, '2026-2027');

    expect(await compte(db, 'unites')).toBe(1);
    expect(await compte(db, 'activites')).toBe(1);
    expect(await lookupReferentielCwId(db, 'unite', 'u-gr', '2026-2027')).toBe(1001727);
    expect(await lookupReferentielCwId(db, 'activite', 'a-camps', '2026-2027')).toBe(1001726);
    // L'exercice précédent n'est pas deviné : il sera mappé par sa propre sync.
    expect(await lookupReferentielCwId(db, 'unite', 'u-gr', '2025-2026')).toBeNull();
  });

  it('est idempotente sur un même exercice', async () => {
    const db = await setup();
    const input = refs([[1001727, 'Groupe']], [[1001726, 'Camps']]);

    await applyReferentielsSync(db, 'g1', input, NOW, '2026-2027');
    const r = await applyReferentielsSync(db, 'g1', input, NOW, '2026-2027');

    expect(r.unites).toMatchObject({ ajoutees: 0, mappees: 0, inchangees: 1 });
    expect(r.activites).toMatchObject({ ajoutees: 0, mappees: 0, inchangees: 1 });
  });

  it('deux options CW homonymes dans un même exercice restent deux unités distinctes', async () => {
    const db = await setup();

    await applyReferentielsSync(db, 'g1', refs([[1, 'Projet'], [2, 'Projet']], []), NOW, '2026-2027');

    expect(await compte(db, 'unites')).toBe(2);
    const ids = await db.prepare('SELECT id FROM unites ORDER BY id').all<{ id: string }>();
    const cw = await Promise.all(ids.map((r) => lookupReferentielCwId(db, 'unite', r.id, '2026-2027')));
    expect(cw.sort()).toEqual([1, 2]);
  });

  it("n'emprunte pas l'unité d'un autre groupe", async () => {
    const db = await setup();
    await db.exec(`
      INSERT INTO unites (id, group_id, code, name, comptaweb_id, created_at)
        VALUES ('u-autre', 'g2', 'GR', 'Groupe', 904730, '2026-01-01');
    `);

    await applyReferentielsSync(db, 'g1', refs([[1001727, 'Groupe']], []), NOW, '2026-2027');

    const rows = await db.prepare("SELECT id FROM unites WHERE group_id = 'g1'").all<{ id: string }>();
    expect(rows).toHaveLength(1);
    expect(await lookupReferentielCwId(db, 'unite', 'u-autre', '2026-2027')).toBeNull();
  });
});

describe('fusionnerDoublonsReferentiels — réparation des doublons déjà créés', () => {
  async function etatProd(db: DbWrapper) {
    await db.exec(`
      INSERT INTO unites (id, group_id, code, name, comptaweb_id, created_at) VALUES
        ('u-gr', 'g1', 'GR', 'Groupe', 904730, '2026-04-01'),
        ('u-gr-2', 'g1', 'GR2', 'Groupe', 1001727, '2026-09-20'),
        ('u-co', 'g1', 'CO', 'Compagnons', 905000, '2026-04-01'),
        ('u-local', 'g1', 'LO', 'Compagnons', NULL, '2026-05-01');
      INSERT INTO activites (id, group_id, name, comptaweb_id, created_at) VALUES
        ('a-camps', 'g1', 'Camps', 904729, '2026-04-01'),
        ('a-camps-2', 'g1', 'Camps', 1001726, '2026-09-20');
      INSERT INTO ecritures (id, unite_id, activite_id) VALUES
        ('e1', 'u-gr', 'a-camps'),
        ('e2', 'u-gr-2', 'a-camps-2');
      INSERT INTO user_unites (user_id, unite_id) VALUES ('usr1', 'u-gr'), ('usr1', 'u-gr-2'), ('usr2', 'u-gr-2');
    `);
  }

  it('rattache les références au plus ancien exemplaire puis retire le doublon', async () => {
    const db = await setup();
    await etatProd(db);

    const res = await fusionnerDoublonsReferentiels(db);

    const unites = await db.prepare('SELECT id FROM unites ORDER BY id').all<{ id: string }>();
    expect(unites.map((u) => u.id)).toEqual(['u-co', 'u-gr', 'u-local']);
    const acts = await db.prepare('SELECT id FROM activites').all<{ id: string }>();
    expect(acts.map((a) => a.id)).toEqual(['a-camps']);

    const e2 = await db.prepare("SELECT unite_id, activite_id FROM ecritures WHERE id = 'e2'").get();
    expect(e2).toEqual({ unite_id: 'u-gr', activite_id: 'a-camps' });
    const scopes = await db
      .prepare('SELECT user_id, unite_id FROM user_unites ORDER BY user_id')
      .all<{ user_id: string; unite_id: string }>();
    expect(scopes).toEqual([
      { user_id: 'usr1', unite_id: 'u-gr' },
      { user_id: 'usr2', unite_id: 'u-gr' },
    ]);
    expect(res.fusionnees).toEqual(expect.arrayContaining(['unites:u-gr-2', 'activites:a-camps-2']));
  });

  it("ne touche pas une unité locale homonyme (sans comptaweb_id) et est idempotente", async () => {
    const db = await setup();
    await etatProd(db);

    await fusionnerDoublonsReferentiels(db);
    const res = await fusionnerDoublonsReferentiels(db);

    expect(res.fusionnees).toEqual([]);
    const local = await db.prepare("SELECT id FROM unites WHERE id = 'u-local'").get();
    expect(local).toBeTruthy();
  });
});
