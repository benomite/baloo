import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
let testClient: Client;
let idCounter = 0;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({
  nextIdOn: async (_db: unknown, p: string) => `${p}-${++idCounter}`,
  nextId: async (p: string) => `${p}-${++idCounter}`,
  currentTimestamp: () => '2026-07-13T10:00:00Z',
}));

import { ventilateDraft } from '../ecritures-ventilate';

// NB (écart d'environnement documenté, cf. task-2-brief.md) : 'file::memory:'
// nu ne survit pas à l'ouverture d'une transaction libsql — `db.transaction`
// (cf. ../../db.ts) démarre la transaction sur la connexion courante du
// client PUIS force une nouvelle connexion lazy pour tout usage ultérieur du
// même client. Sans cache partagé, cette nouvelle connexion pointerait vers
// une base in-memory anonyme totalement différente (vide). `?cache=shared`
// fait que toutes les connexions ouvertes sur `file::memory:` dans le
// process partagent le même contenu.
//
// Corollaire vérifié empiriquement : le client racine ET la connexion
// utilisée par la transaction (jamais fermée explicitement par
// `Sqlite3Transaction`, cf. lib @libsql/client) restent ouvertes tant que le
// process tourne, donc le cache partagé anonyme **fuit d'un test à
// l'autre** si on refait un `CREATE TABLE` par test (already exists). Pour
// rester sur le seul écart autorisé par le brief (l'URL de connexion), le
// schéma est créé UNE SEULE FOIS (`beforeAll`) et chaque test repart d'un
// état propre via `beforeEach` (DELETE + ré-INSERT de la tête `E1`), au lieu
// de recréer les tables à chaque test.
beforeAll(async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  testClient = client;
  await client.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(client);
  await testDb.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, unite_id TEXT, category_id TEXT,
      mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT, carte_id TEXT,
      justif_attendu INTEGER DEFAULT 1, notes TEXT, ligne_bancaire_id INTEGER,
      ligne_bancaire_sous_index INTEGER, libelle_origine TEXT,
      ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
      status TEXT NOT NULL, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT);
    CREATE TABLE depots_justificatifs (id TEXT, ecriture_id TEXT);
    CREATE TABLE remboursements (id TEXT, ecriture_id TEXT);
  `);
});

afterAll(async () => { await testClient.close(); });

async function setup(): Promise<DbWrapper> {
  idCounter = 0;
  await testDb.exec(`
    DELETE FROM ecritures;
    DELETE FROM justificatifs;
    DELETE FROM depots_justificatifs;
    DELETE FROM remboursements;
  `);
  await testDb.prepare(
    `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
       category_id, unite_id, activite_id, ligne_bancaire_id, ligne_bancaire_sous_index,
       libelle_origine, status, created_at, updated_at)
     VALUES ('E1','g1','2026-05-13','LECLERC',1064,'depense','c-int','u-farfa','a-camps',
       999, 0, 'LECLERC', 'draft','t','t')`,
  ).run();
  return testDb;
}

const V = (amount_cents: number, category_id: string) => ({
  amount_cents, category_id, unite_id: 'u-farfa', activite_id: 'a-camps',
});

describe('ventilateDraft', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('éclate un draft en N lignes groupées, préserve l\'id tête', async () => {
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(364, 'c-pharma')]);
    expect(res.ok).toBe(true);
    expect(res.ids).toContain('E1');
    expect(res.ids).toHaveLength(2);
    const rows = await testDb.prepare(
      "SELECT id, amount_cents, category_id, ventilation_group_id, ligne_bancaire_id FROM ecritures WHERE group_id='g1' ORDER BY amount_cents DESC",
    ).all<{ id: string; amount_cents: number; category_id: string; ventilation_group_id: string; ligne_bancaire_id: number }>();
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('E1'); // tête réutilisée (montant le plus haut = 700)
    expect(rows[0].amount_cents).toBe(700);
    expect(rows[0].ligne_bancaire_id).toBe(999); // identité bancaire préservée
    expect(rows[0].ventilation_group_id).toMatch(/^vg_/);
    expect(rows[1].ventilation_group_id).toBe(rows[0].ventilation_group_id);
  });

  it('refuse si Σ ≠ total du groupe', async () => {
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(200, 'c-pharma')]);
    expect(res).toMatchObject({ ok: false, reason: 'sum_mismatch' });
    const n = await testDb.prepare("SELECT COUNT(*) n FROM ecritures WHERE group_id='g1'").get<{ n: number }>();
    expect(n?.n).toBe(1); // rollback : rien créé
  });

  it('refuse une ventilation incomplète', async () => {
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [
      { amount_cents: 700, category_id: null, unite_id: 'u-farfa', activite_id: 'a-camps' }, V(364, 'c-pharma'),
    ]);
    expect(res).toMatchObject({ ok: false, reason: 'incomplete' });
  });

  it('masque une tête hors scope multi-unités (not_found)', async () => {
    // La tête E1 est sur u-farfa ; un chef scopé sur une autre unité ne
    // doit pas pouvoir la ventiler (même en devinant son id).
    const res = await ventilateDraft({ groupId: 'g1', scopeUniteIds: ['u-autre'] }, 'E1', [V(700, 'c-int'), V(364, 'c-pharma')]);
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
    const n = await testDb.prepare("SELECT COUNT(*) n FROM ecritures WHERE group_id='g1'").get<{ n: number }>();
    expect(n?.n).toBe(1); // rien touché
  });

  it('refuse mirror / déjà dans CW', async () => {
    await testDb.prepare("UPDATE ecritures SET comptaweb_ecriture_id = 42 WHERE id='E1'").run();
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(364, 'c-pharma')]);
    expect(res).toMatchObject({ ok: false, reason: 'in_cw' });
  });

  it('recolle un groupe en 1 ligne (collapse) et supprime la surnuméraire', async () => {
    await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(364, 'c-pharma')]);
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(1064, 'c-int')]);
    expect(res.ok).toBe(true);
    expect(res.ventilation_group_id).toBeNull();
    const rows = await testDb.prepare("SELECT id, ventilation_group_id FROM ecritures WHERE group_id='g1'").all<{ id: string; ventilation_group_id: string | null }>();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('E1');
    expect(rows[0].ventilation_group_id).toBeNull();
  });

  it('bloque le collapse si une ligne surnuméraire porte une pièce', async () => {
    await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(364, 'c-pharma')]);
    const child = await testDb.prepare("SELECT id FROM ecritures WHERE group_id='g1' AND id != 'E1'").get<{ id: string }>();
    await testDb.prepare("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('j1','ecriture',?)").run(child!.id);
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(1064, 'c-int')]);
    expect(res).toMatchObject({ ok: false, reason: 'child_has_attachments' });
    const n = await testDb.prepare("SELECT COUNT(*) n FROM ecritures WHERE group_id='g1'").get<{ n: number }>();
    expect(n?.n).toBe(2); // rollback : rien supprimé
  });
});
