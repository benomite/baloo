// Un groupe de ventilation ne fait QU'UNE pièce Comptaweb : les champs
// d'en-tête (date, libellé, sens, mode de paiement, carte, n° pièce,
// justif attendu) sont ceux de la pièce, pas de la ventilation —
// `ventilateDraft` les copie de la tête vers les enfants à la création, et
// `syncDraftToComptaweb` n'envoie que ceux de la tête. Les éditer ligne par
// ligne faisait diverger le groupe : « Modes multiples » sur un paiement
// unique, membres jugés incomplets, bouton « Valider » grisé (cas réel prod
// 2026-07-27, virement groupé MERSCH). Ce test prouve la propagation au
// niveau du VRAI service, et la NON-propagation de l'imputation.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { updateEcriture } from '../ecritures';

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, category_id TEXT,
    mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT, carte_id TEXT,
    date_ecriture TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1, comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    notes TEXT, ligne_bancaire_id INTEGER, ligne_bancaire_sous_index INTEGER,
    libelle_origine TEXT, ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
    created_at TEXT NOT NULL DEFAULT '2026-07-21T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-07-21T00:00:00Z'
  );
  CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT, name TEXT, couleur TEXT);
  CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE activites (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, porteur TEXT, type TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
`;

async function membre(id: string) {
  return await testDb
    .prepare('SELECT * FROM ecritures WHERE id = ?')
    .get<Record<string, unknown>>(id);
}

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(client);
  await testDb.exec(SETUP_SQL);
  await testDb.exec(`
    INSERT INTO modes_paiement (id, name) VALUES ('mp-virement', 'Virement');
    -- Tête + 2 enfants du même groupe de ventilation (draft, hors Comptaweb).
    INSERT INTO ecritures (id, group_id, ventilation_group_id, date_ecriture, description,
                           amount_cents, type, category_id, unite_id, activite_id)
      VALUES ('T', 'g1', 'vg1', '2026-07-20', 'RBST FRAIS', 599, 'depense', 'c1', 'u1', 'a1');
    INSERT INTO ecritures (id, group_id, ventilation_group_id, date_ecriture, description,
                           amount_cents, type, category_id, unite_id, activite_id)
      VALUES ('C1', 'g1', 'vg1', '2026-07-20', 'RBST FRAIS', 16112, 'depense', 'c2', 'u2', 'a2');
    INSERT INTO ecritures (id, group_id, ventilation_group_id, date_ecriture, description,
                           amount_cents, type, category_id, unite_id, activite_id)
      VALUES ('C2', 'g1', 'vg1', '2026-07-20', 'RBST FRAIS', 18091, 'depense', 'c3', 'u3', 'a3');
    -- Écriture hors groupe : ne doit jamais être touchée.
    INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type)
      VALUES ('X', 'g1', '2026-07-20', 'Autre', 5000, 'depense');
  `);
});

describe('updateEcriture — champs d’en-tête propagés au groupe de ventilation', () => {
  it('le mode de paiement posé sur la tête descend sur tous les membres', async () => {
    await updateEcriture({ groupId: 'g1' }, 'T', { mode_paiement_id: 'mp-virement' });
    expect((await membre('T'))!.mode_paiement_id).toBe('mp-virement');
    expect((await membre('C1'))!.mode_paiement_id).toBe('mp-virement');
    expect((await membre('C2'))!.mode_paiement_id).toBe('mp-virement');
    expect((await membre('X'))!.mode_paiement_id).toBeNull();
  });

  it('édité depuis un enfant, le mode remonte aussi sur la tête (même pièce)', async () => {
    await updateEcriture({ groupId: 'g1' }, 'C1', { mode_paiement_id: 'mp-virement' });
    expect((await membre('T'))!.mode_paiement_id).toBe('mp-virement');
    expect((await membre('C2'))!.mode_paiement_id).toBe('mp-virement');
  });

  it('date, libellé, sens, n° pièce et justif attendu suivent la pièce entière', async () => {
    await updateEcriture({ groupId: 'g1' }, 'T', {
      date_ecriture: '2026-07-22',
      description: 'Virement Florence Mersch',
      type: 'recette',
      numero_piece: 'P42',
      justif_attendu: false,
    });
    for (const id of ['T', 'C1', 'C2']) {
      const m = (await membre(id))!;
      expect(m.date_ecriture).toBe('2026-07-22');
      expect(m.description).toBe('Virement Florence Mersch');
      expect(m.type).toBe('recette');
      expect(m.numero_piece).toBe('P42');
      expect(m.justif_attendu).toBe(0);
    }
  });

  it('l’imputation et le montant restent PROPRES à la ligne éditée', async () => {
    await updateEcriture({ groupId: 'g1' }, 'T', {
      category_id: 'c9',
      unite_id: 'u9',
      activite_id: 'a9',
      amount_cents: 700,
    });
    const t = (await membre('T'))!;
    expect([t.category_id, t.unite_id, t.activite_id, t.amount_cents]).toEqual(['c9', 'u9', 'a9', 700]);
    const c1 = (await membre('C1'))!;
    expect([c1.category_id, c1.unite_id, c1.activite_id, c1.amount_cents]).toEqual(['c2', 'u2', 'a2', 16112]);
  });

  it('un membre déjà matérialisé dans Comptaweb n’est pas touché', async () => {
    await testDb.prepare("UPDATE ecritures SET status = 'mirror', comptaweb_ecriture_id = 777 WHERE id = 'C2'").run();
    await updateEcriture({ groupId: 'g1' }, 'T', { mode_paiement_id: 'mp-virement' });
    expect((await membre('C1'))!.mode_paiement_id).toBe('mp-virement');
    expect((await membre('C2'))!.mode_paiement_id).toBeNull();
  });

  it('les notes restent locales à la ligne (contenu saisi, jamais écrasé ailleurs)', async () => {
    await testDb.prepare("UPDATE ecritures SET notes = 'note enfant' WHERE id = 'C1'").run();
    await updateEcriture({ groupId: 'g1' }, 'T', { notes: 'note tête' });
    expect((await membre('T'))!.notes).toBe('note tête');
    expect((await membre('C1'))!.notes).toBe('note enfant');
  });
});
