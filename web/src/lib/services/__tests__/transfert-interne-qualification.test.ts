// Critère 1 (#51) : un brouillon issu d'une ligne bancaire se qualifie en
// « Transfert interne » avec un mode (dépôt, retrait ou transfert de caisse).
// Le choix est enregistré et relu à la réouverture du brouillon.
//
// Contrat : `type = 'transfert_interne'` et colonne `mode_transfert` parmi
// 'depot_especes' | 'retrait_especes' | 'transfert_especes'.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { updateEcriture, getEcriture } from '../ecritures';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    category_id TEXT,
    mode_paiement_id TEXT,
    activite_id TEXT,
    numero_piece TEXT,
    carte_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL,
    mode_transfert TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    libelle_origine TEXT,
    ventilation_group_id TEXT,
    comptaweb_ecriture_id INTEGER,
    created_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z'
  );
  CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT, name TEXT, couleur TEXT);
  CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE activites (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, porteur TEXT, type TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
`;

describe('Transfert interne — qualification d’un brouillon bancaire', () => {
  beforeEach(async () => {
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    testDb = wrapClient(client);
    await testDb.exec(SETUP_SQL);
    await testDb
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, ligne_bancaire_id)
         VALUES ('E1', 'g1', '2026-10-03', 'VERSEMENT ESPECES', 25000, 'recette', 'draft', 4242)`,
      )
      .run();
  });

  it.each(['depot_especes', 'retrait_especes', 'transfert_especes'])(
    'enregistre le type et le mode %s, relus à la réouverture',
    async (mode) => {
      const updated = await updateEcriture({ groupId: 'g1' }, 'E1', {
        type: 'transfert_interne',
        mode_transfert: mode,
      } as never);
      expect(updated).not.toBeNull();

      const rouvert = (await getEcriture({ groupId: 'g1' }, 'E1')) as unknown as Record<string, unknown>;
      expect(rouvert.type).toBe('transfert_interne');
      expect(rouvert.mode_transfert).toBe(mode);
    },
  );
});
