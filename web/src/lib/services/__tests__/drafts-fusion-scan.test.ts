// Fusion de brouillons (ticket #49) vue depuis le scan des lignes bancaires.
//
// Cas terrain 2026-11-21 : une famille paie en deux virements, le scan crée un
// brouillon par ligne. Supprimer l'un des deux « ne tenait pas » : le cycle
// suivant le recréait depuis sa ligne bancaire, toujours non rapprochée dans
// Comptaweb. Après une fusion, le scan suivant ne doit RIEN recréer : le
// brouillon absorbé garde sa ligne et son libellé d'origine, le scan le
// reconnaît et le laisse tel quel.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wrapClient, type DbWrapper } from '../../db';

const bankLinesRef: { value: unknown[] } = { value: [] };
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async () => ({ ecrituresBancaires: bankLinesRef.value }),
  listRapprochementBancaire: async () => ({ ecrituresBancaires: bankLinesRef.value }),
  createEcriture: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
let idCounter = 0;
vi.mock('../../ids', () => ({
  nextId: async (prefix: string) => `${prefix}-NEW-${++idCounter}`,
  nextIdOn: async (_db: unknown, prefix: string) => `${prefix}-NEW-${++idCounter}`,
  currentTimestamp: () => '2026-11-21T09:00:00Z',
}));

import { scanDraftsFromComptaweb } from '../drafts';
import { fusionnerBrouillons } from '../ecritures-fusion';

const G = 'g1';
let db: DbWrapper;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baloo-fusion-scan-'));
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  await client.execute('PRAGMA foreign_keys = OFF');
  db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, date_ecriture TEXT NOT NULL,
      description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
      category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT,
      status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1,
      comptaweb_synced INTEGER NOT NULL DEFAULT 0, ligne_bancaire_id INTEGER,
      ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER, carte_id TEXT,
      libelle_origine TEXT, ventilation_group_id TEXT, fusionne_dans_id TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-11-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-11-01T00:00:00Z'
    );
    CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
    CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
    CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT, date_paiement TEXT);
    CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
    CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT);
  `);
});

beforeEach(async () => {
  idCounter = 0;
  await db.exec('DELETE FROM ecritures; DELETE FROM justificatifs;');
  // Deux virements de la même famille, toujours non rapprochés dans CW.
  bankLinesRef.value = [
    { id: 201, dateOperation: '2026-10-03', montantCentimes: 10000, intitule: 'VIR DE M DUPONT INSCRIPTION 1/2', sousLignes: [] },
    { id: 202, dateOperation: '2026-10-10', montantCentimes: 5000, intitule: 'VIR DE M DUPONT INSCRIPTION 2/2', sousLignes: [] },
  ];
});

async function rows() {
  return db
    .prepare('SELECT id, status, amount_cents, ligne_bancaire_id, fusionne_dans_id FROM ecritures ORDER BY id')
    .all<{ id: string; status: string; amount_cents: number; ligne_bancaire_id: number; fusionne_dans_id: string | null }>();
}

describe('scan des lignes bancaires après une fusion', () => {
  it('ne recrée pas le brouillon absorbé depuis sa ligne bancaire', async () => {
    const premier = await scanDraftsFromComptaweb({ groupId: G }, db);
    expect(premier.crees).toBe(2);
    const [a, b] = await rows();

    const fusion = await fusionnerBrouillons({ groupId: G }, { cibleId: a.id, absorbesIds: [b.id] }, db);
    expect(fusion.ok).toBe(true);

    const second = await scanDraftsFromComptaweb({ groupId: G }, db);
    expect(second.crees).toBe(0);
    expect(second.supprimes).toBe(0);
    expect(second.existants).toBe(2);

    expect(await rows()).toEqual([
      { id: a.id, status: 'draft', amount_cents: 15000, ligne_bancaire_id: 201, fusionne_dans_id: null },
      { id: b.id, status: 'fusionne', amount_cents: 5000, ligne_bancaire_id: 202, fusionne_dans_id: a.id },
    ]);
    const brouillons = await db
      .prepare("SELECT COUNT(*) AS n FROM ecritures WHERE status = 'draft'")
      .get<{ n: number }>();
    expect(brouillons?.n).toBe(1);
  });

  it('tient aussi quand la sync borne le scan à l’exercice', async () => {
    await scanDraftsFromComptaweb({ groupId: G }, db);
    const [a, b] = await rows();
    await fusionnerBrouillons({ groupId: G }, { cibleId: a.id, absorbesIds: [b.id], description: 'Inscription Dupont' }, db);

    const second = await scanDraftsFromComptaweb({ groupId: G }, db, {
      config: {} as never,
      exercice: { debut: '2026-09-01', fin: '2027-08-31' },
    });
    expect(second.crees).toBe(0);
    expect((await rows()).map((r) => r.status)).toEqual(['draft', 'fusionne']);
  });
});
