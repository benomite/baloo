import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';
import {
  selectAnneeParUnite,
  selectAnneeParActivite,
  defaultActivitesExcluesIds,
  buildAnneeRows,
  selectAnneeEcritures,
} from '../annee';

// Schéma minimal : ecritures + unites + activites + categories.
const SETUP_SQL = `
  CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE activites (id TEXT PRIMARY KEY, group_id TEXT, name TEXT);
  CREATE TABLE unites (id TEXT PRIMARY KEY, group_id TEXT, code TEXT, name TEXT, couleur TEXT);
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, activite_id TEXT, unite_id TEXT,
    date_ecriture TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL, category_id TEXT, status TEXT NOT NULL DEFAULT 'mirror'
  );
`;

const BORNES = { start: '2025-09-01', end: '2026-08-31' };

async function setupDb() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  const db = wrapClient(client);
  await db.prepare(
    "INSERT INTO categories (id, name) VALUES ('cat-part', 'Participations'), ('cat-depot-especes', 'Dépôt espèces'), ('cat-flux-structures', 'Flux structures')",
  ).run();
  await db.prepare(
    "INSERT INTO activites (id, group_id, name) VALUES ('act-annee', 'g1', 'Activités d''année'), ('act-camps', 'g1', 'Camps'), ('act-fct', 'g1', 'Fonctionnement')",
  ).run();
  await db.prepare(
    "INSERT INTO unites (id, group_id, code, name, couleur) VALUES ('u-pc', 'g1', 'PC', 'Pionniers-Caravelles', 'rouge'), ('u-lj', 'g1', 'LJ', 'Louveteaux-Jeannettes', 'orange'), ('u-sg', 'g1', 'SG', 'Scouts-Guides', 'bleu'), ('u-x', 'autre-groupe', 'XX', 'Autre groupe', null)",
  ).run();
  return db;
}

let seq = 0;
async function ins(
  db: Awaited<ReturnType<typeof setupDb>>,
  over: Partial<{
    gid: string; act: string | null; uni: string | null; type: string;
    cat: string | null; amt: number; date: string; status: string;
  }> = {},
) {
  seq += 1;
  await db.prepare(
    'INSERT INTO ecritures (id, group_id, activite_id, unite_id, date_ecriture, description, amount_cents, type, category_id, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(
    `E${seq}`,
    over.gid ?? 'g1',
    over.act === undefined ? 'act-annee' : over.act,
    over.uni === undefined ? 'u-pc' : over.uni,
    over.date ?? '2026-02-09',
    `desc E${seq}`,
    over.amt ?? 10000,
    over.type ?? 'depense',
    over.cat === undefined ? 'cat-part' : over.cat,
    over.status ?? 'mirror',
  );
}

describe('defaultActivitesExcluesIds', () => {
  it('exclut par défaut les activités dont le nom évoque un camp', () => {
    const ids = defaultActivitesExcluesIds([
      { id: 'act-annee', name: "Activités d'année" },
      { id: 'act-camps', name: 'Camps' },
      { id: 'act-fct', name: 'Fonctionnement' },
    ]);
    expect(ids).toEqual(['act-camps']);
  });

  it('attrape les variantes de casse et de formulation', () => {
    const ids = defaultActivitesExcluesIds([
      { id: 'a', name: "CAMP D'ÉTÉ" },
      { id: 'b', name: 'camps et séjours' },
      { id: 'c', name: 'Week-ends' },
    ]);
    expect(ids).toEqual(['a', 'b']);
  });

  it('ne renvoie rien si le groupe n’a pas d’activité de camp', () => {
    expect(defaultActivitesExcluesIds([{ id: 'a', name: 'Sorties' }])).toEqual([]);
  });
});

describe('selectAnneeParUnite', () => {
  let db: Awaited<ReturnType<typeof setupDb>>;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('agrège recettes / dépenses / solde par unité', async () => {
    await ins(db, { uni: 'u-pc', type: 'recette', amt: 96558 });
    await ins(db, { uni: 'u-pc', type: 'depense', amt: 66303 });
    await ins(db, { uni: 'u-lj', type: 'depense', amt: 41171 });

    const rows = await selectAnneeParUnite(db, 'g1', BORNES, ['act-camps']);
    const pc = rows.find((r) => r.unite_id === 'u-pc')!;
    expect(pc.recettes).toBe(96558);
    expect(pc.depenses).toBe(66303);
    expect(pc.solde).toBe(30255);
    expect(pc.nb).toBe(2);

    const lj = rows.find((r) => r.unite_id === 'u-lj')!;
    expect(lj.solde).toBe(-41171);
  });

  it('exclut les activités passées en exclusion, garde les écritures sans activité', async () => {
    await ins(db, { act: 'act-camps', amt: 50000 });  // camp → exclu
    await ins(db, { act: null, amt: 700 });           // sans activité → gardé
    await ins(db, { act: 'act-fct', amt: 300 });      // autre activité → gardé

    const rows = await selectAnneeParUnite(db, 'g1', BORNES, ['act-camps']);
    const pc = rows.find((r) => r.unite_id === 'u-pc')!;
    expect(pc.depenses).toBe(1000);
    expect(pc.nb).toBe(2);
  });

  it('exclut les catégories hors résultat (dépôts, flux entre structures)', async () => {
    await ins(db, { type: 'recette', cat: 'cat-flux-structures', amt: 6822 });
    await ins(db, { type: 'recette', cat: 'cat-depot-especes', amt: 20000 });
    await ins(db, { type: 'recette', cat: 'cat-part', amt: 6000 });

    const rows = await selectAnneeParUnite(db, 'g1', BORNES, ['act-camps']);
    expect(rows.find((r) => r.unite_id === 'u-pc')!.recettes).toBe(6000);
  });

  it('borne sur l’exercice : ignore avant le 01/09 et après le 31/08', async () => {
    await ins(db, { date: '2025-08-31', amt: 1111 });
    await ins(db, { date: '2026-09-01', amt: 2222 });
    await ins(db, { date: '2025-09-01', amt: 100 });
    await ins(db, { date: '2026-08-31', amt: 200 });

    const rows = await selectAnneeParUnite(db, 'g1', BORNES, []);
    expect(rows.find((r) => r.unite_id === 'u-pc')!.depenses).toBe(300);
  });

  it('isole les écritures non imputées sous unite_id null', async () => {
    await ins(db, { uni: null, type: 'depense', amt: 62850 });
    await ins(db, { uni: null, type: 'recette', amt: 26500 });

    const rows = await selectAnneeParUnite(db, 'g1', BORNES, []);
    const orphelines = rows.find((r) => r.unite_id === null)!;
    expect(orphelines.depenses).toBe(62850);
    expect(orphelines.recettes).toBe(26500);
    expect(orphelines.nb).toBe(2);
  });

  it('ne fuit pas les écritures d’un autre groupe', async () => {
    await ins(db, { gid: 'autre-groupe', uni: 'u-x', amt: 99999 });
    const rows = await selectAnneeParUnite(db, 'g1', BORNES, []);
    expect(rows.some((r) => r.unite_id === 'u-x')).toBe(false);
    expect(rows.reduce((s, r) => s + r.depenses, 0)).toBe(0);
  });

  it('compte les brouillons (vue « tout »), en les signalant à part', async () => {
    await ins(db, { status: 'draft', amt: 4111 });
    await ins(db, { status: 'mirror', amt: 1000 });

    const rows = await selectAnneeParUnite(db, 'g1', BORNES, []);
    const pc = rows.find((r) => r.unite_id === 'u-pc')!;
    expect(pc.depenses).toBe(5111);
    expect(pc.nb_drafts).toBe(1);
  });
});

describe('buildAnneeRows', () => {
  it('liste toutes les unités du groupe, même à zéro, triées par code', async () => {
    const db = await setupDb();
    await ins(db, { uni: 'u-sg', type: 'depense', amt: 47545 });

    const rows = await buildAnneeRows(db, 'g1', BORNES, []);
    expect(rows.map((r) => r.code)).toEqual(['LJ', 'PC', 'SG']);
    expect(rows.find((r) => r.code === 'LJ')!.solde).toBe(0);
    expect(rows.find((r) => r.code === 'SG')!.solde).toBe(-47545);
  });

  it('place les non imputées en dernier avec un libellé explicite', async () => {
    const db = await setupDb();
    await ins(db, { uni: null, amt: 500 });

    const rows = await buildAnneeRows(db, 'g1', BORNES, []);
    const last = rows[rows.length - 1];
    expect(last.unite_id).toBeNull();
    expect(last.name).toBe('Non imputé');
    expect(last.depenses).toBe(500);
  });

  it('n’ajoute pas de ligne « non imputé » quand tout est imputé', async () => {
    const db = await setupDb();
    await ins(db, { uni: 'u-pc', amt: 500 });

    const rows = await buildAnneeRows(db, 'g1', BORNES, []);
    expect(rows.some((r) => r.unite_id === null)).toBe(false);
  });
});

describe('selectAnneeEcritures', () => {
  it('liste les écritures du périmètre, plus récentes d’abord, hors exclusions', async () => {
    const db = await setupDb();
    await ins(db, { uni: 'u-pc', date: '2025-10-04', amt: 12380 });
    await ins(db, { uni: 'u-pc', date: '2026-02-19', type: 'recette', amt: 6000 });
    await ins(db, { uni: 'u-pc', act: 'act-camps', date: '2026-07-10', amt: 90000 });
    await ins(db, { uni: 'u-lj', date: '2026-03-01', amt: 500 });

    const rows = await selectAnneeEcritures(db, 'g1', BORNES, ['act-camps'], 'u-pc');
    expect(rows.map((r) => r.date_ecriture)).toEqual(['2026-02-19', '2025-10-04']);
    expect(rows[0].category_name).toBe('Participations');
    expect(rows[0].activite_name).toBe("Activités d'année");
  });

  it('sait lister les non imputées', async () => {
    const db = await setupDb();
    await ins(db, { uni: null, amt: 4111 });
    await ins(db, { uni: 'u-pc', amt: 1000 });

    const rows = await selectAnneeEcritures(db, 'g1', BORNES, [], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(4111);
  });
});

describe('selectAnneeParActivite', () => {
  it('détaille une unité par activité, hors exclusions', async () => {
    const db = await setupDb();
    await ins(db, { uni: 'u-pc', act: 'act-annee', type: 'recette', amt: 63845 });
    await ins(db, { uni: 'u-pc', act: 'act-fct', type: 'depense', amt: 4800 });
    await ins(db, { uni: 'u-pc', act: 'act-camps', type: 'depense', amt: 90000 });
    await ins(db, { uni: 'u-lj', act: 'act-annee', type: 'depense', amt: 41171 });

    const rows = await selectAnneeParActivite(db, 'g1', BORNES, ['act-camps'], 'u-pc');
    expect(rows).toHaveLength(2);
    const annee = rows.find((r) => r.activite_id === 'act-annee')!;
    expect(annee.activite_name).toBe("Activités d'année");
    expect(annee.recettes).toBe(63845);
    expect(rows.find((r) => r.activite_id === 'act-camps')).toBeUndefined();
  });

  it('nomme les écritures sans activité', async () => {
    const db = await setupDb();
    await ins(db, { uni: 'u-pc', act: null, amt: 1200 });

    const rows = await selectAnneeParActivite(db, 'g1', BORNES, [], 'u-pc');
    expect(rows[0].activite_id).toBeNull();
    expect(rows[0].activite_name).toBe('(sans activité)');
  });
});
