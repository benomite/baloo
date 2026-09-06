import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';
import {
  selectCampEcritures,
  selectDepotsOrphelins,
  countDepotsSansImputation,
} from '../camp-bilan';

const SETUP_SQL = `
  CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, nom_affichage TEXT);
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, activite_id TEXT, unite_id TEXT,
    date_ecriture TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL, category_id TEXT, justif_attendu INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE depots_justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, submitted_by_user_id TEXT,
    titre TEXT NOT NULL, category_id TEXT, unite_id TEXT, activite_id TEXT,
    amount_cents INTEGER, date_estimee TEXT, statut TEXT NOT NULL,
    ecriture_id TEXT, motif_rejet TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-07-01T00:00:00Z'
  );
`;

async function setupDb() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  const db = wrapClient(client);
  await db.prepare("INSERT INTO categories (id, name) VALUES ('cat-int', 'Intendance'), ('cat-depot-especes', 'Transfert')").run();
  await db.prepare("INSERT INTO users (id, nom_affichage) VALUES ('u1', 'Akela')").run();
  return db;
}

type EcrOver = Partial<{ gid: string; act: string; uni: string | null; type: string; cat: string | null; amt: number; date: string; justif: number }>;

async function insEcr(db: Awaited<ReturnType<typeof setupDb>>, id: string, over: EcrOver = {}) {
  await db.prepare(
    `INSERT INTO ecritures (id, group_id, activite_id, unite_id, date_ecriture, description, amount_cents, type, category_id, justif_attendu)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, over.gid ?? 'g1', over.act ?? 'ACT1', over.uni === undefined ? 'UNI1' : over.uni,
    over.date ?? '2026-07-10', `desc ${id}`, over.amt ?? 10000, over.type ?? 'depense',
    over.cat === undefined ? 'cat-int' : over.cat, over.justif ?? 1,
  );
}

describe('selectCampEcritures', () => {
  let db: Awaited<ReturnType<typeof setupDb>>;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('retourne dépenses ET recettes du camp, triées par date décroissante', async () => {
    await insEcr(db, 'D1', { date: '2026-07-10' });
    await insEcr(db, 'R1', { type: 'recette', date: '2026-07-20' });
    const res = await selectCampEcritures(db, 'g1', 'ACT1', 'UNI1');
    expect(res.map((e) => e.id)).toEqual(['R1', 'D1']);
    expect(res[0].type).toBe('recette');
    expect(res[1].category_name).toBe('Intendance');
    expect(res[1].category_id).toBe('cat-int');
  });

  it('exclut les écritures d’une autre activité, unité ou groupe', async () => {
    await insEcr(db, 'OK');
    await insEcr(db, 'X1', { act: 'AUTRE' });
    await insEcr(db, 'X2', { uni: 'AUTRE' });
    await insEcr(db, 'X3', { gid: 'autre-groupe' });
    const res = await selectCampEcritures(db, 'g1', 'ACT1', 'UNI1');
    expect(res.map((e) => e.id)).toEqual(['OK']);
  });

  it('exclut les catégories hors résultat (transferts)', async () => {
    await insEcr(db, 'OK');
    await insEcr(db, 'T1', { cat: 'cat-depot-especes' });
    const res = await selectCampEcritures(db, 'g1', 'ACT1', 'UNI1');
    expect(res.map((e) => e.id)).toEqual(['OK']);
  });

  it('un justificatif obsolète ne compte pas comme pièce présente', async () => {
    await insEcr(db, 'D1');
    await insEcr(db, 'D2', { date: '2026-07-09' });
    await db.prepare("INSERT INTO justificatifs (id, entity_type, entity_id, obsolete_at) VALUES ('J1','ecriture','D1','2026-08-01T00:00:00Z'), ('J2','ecriture','D2',NULL)").run();
    const res = await selectCampEcritures(db, 'g1', 'ACT1', 'UNI1');
    const byId = Object.fromEntries(res.map((e) => [e.id, e]));
    expect(byId.D1.has_justificatif).toBeFalsy();
    expect(byId.D2.has_justificatif).toBeTruthy();
  });

  it('remonte le remboursement lié quand il existe', async () => {
    await insEcr(db, 'D1');
    await db.prepare("INSERT INTO remboursements (id, ecriture_id) VALUES ('REMB-1','D1')").run();
    const res = await selectCampEcritures(db, 'g1', 'ACT1', 'UNI1');
    expect(res[0].remboursement_id).toBe('REMB-1');
  });
});

describe('selectDepotsOrphelins', () => {
  let db: Awaited<ReturnType<typeof setupDb>>;
  beforeEach(async () => {
    db = await setupDb();
    const rows: Array<[string, string, string | null, string | null, string, string | null]> = [
      ['DEP-A', 'a_traiter', 'ACT1', 'UNI1', 'Courses Leclerc', null],
      ['DEP-R', 'rejete', 'ACT1', 'UNI1', 'Ticket illisible', 'photo floue'],
      ['DEP-OK', 'rattache', 'ACT1', 'UNI1', 'Boulangerie', null],
      ['DEP-X', 'a_traiter', 'AUTRE', 'UNI1', 'Autre activité', null],
    ];
    for (const [id, statut, act, uni, titre, motif] of rows) {
      await db.prepare(
        `INSERT INTO depots_justificatifs (id, group_id, submitted_by_user_id, titre, category_id, unite_id, activite_id, amount_cents, date_estimee, statut, motif_rejet)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, 'g1', 'u1', titre, 'cat-int', uni, act, 4200, '2026-07-12', statut, motif);
    }
  });

  it('remonte les dépôts jamais rattachés : en attente et rejetés', async () => {
    const res = await selectDepotsOrphelins(db, 'g1', 'ACT1', 'UNI1');
    expect(res.map((d) => d.id).sort()).toEqual(['DEP-A', 'DEP-R']);
  });

  it('expose déposant, montant et motif de rejet', async () => {
    const res = await selectDepotsOrphelins(db, 'g1', 'ACT1', 'UNI1');
    const rejete = res.find((d) => d.id === 'DEP-R')!;
    expect(rejete.submitter_name).toBe('Akela');
    expect(rejete.amount_cents).toBe(4200);
    expect(rejete.motif_rejet).toBe('photo floue');
    expect(rejete.category_name).toBe('Intendance');
  });
});

describe('countDepotsSansImputation', () => {
  it('compte les dépôts en attente sans activité ou sans unité, qui n’apparaissent dans aucun camp', async () => {
    const db = await setupDb();
    const rows: Array<[string, string, string | null, string | null]> = [
      ['D-NOACT', 'a_traiter', null, 'UNI1'],
      ['D-NOUNI', 'a_traiter', 'ACT1', null],
      ['D-BOTH', 'a_traiter', null, null],
      ['D-OK', 'a_traiter', 'ACT1', 'UNI1'],
      ['D-RATT', 'rattache', null, null],
    ];
    for (const [id, statut, act, uni] of rows) {
      await db.prepare(
        `INSERT INTO depots_justificatifs (id, group_id, submitted_by_user_id, titre, unite_id, activite_id, statut)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(id, 'g1', 'u1', `titre ${id}`, uni, act, statut);
    }
    expect(await countDepotsSansImputation(db, 'g1')).toBe(3);
  });
});
