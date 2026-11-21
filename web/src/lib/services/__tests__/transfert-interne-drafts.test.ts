// Transfert interne (#51) côté brouillons bancaires :
//  - la validation (`syncDraftToComptaweb`) envoie à Comptaweb un « Transfert
//    interne à la structure » (mode, date, montant, titre, n° de pièce) sans
//    exiger nature / activité / unité / mode de paiement ;
//  - le scan des lignes bancaires ne « recale » pas un brouillon qualifié en
//    transfert interne en recette (son type est une saisie, pas un sens).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
const createEcriture = vi.fn();
const bankLines: { value: unknown[] } = { value: [] };

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async () => ({ ecrituresBancaires: bankLines.value }),
  withComptaweb: async (_cwId: number, cb: (cfg: unknown) => unknown) => cb({}),
  createEcriture: (...a: unknown[]) => createEcriture(...a),
  listRapprochementBancaire: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
vi.mock('../exercice-pour-ecriture', () => ({
  resoudreExercicePourDate: async () => ({ code: '2026-2027', cwId: 1, debut: '2026-09-01', fin: '2027-08-31' }),
}));
vi.mock('../../ids', () => ({
  currentTimestamp: () => '2026-10-04T10:00:00Z',
  nextId: async (p: string) => `${p}-NEW`,
}));

import { syncDraftToComptaweb, scanDraftsFromComptaweb } from '../drafts';

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL, mode_transfert TEXT,
    category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER, carte_id TEXT,
    libelle_origine TEXT, ventilation_group_id TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, uploaded_at TEXT, obsolete_at TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT, date_paiement TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT, type TEXT, comptaweb_id INTEGER);
`;

async function insert(over: Record<string, unknown>): Promise<void> {
  const row = {
    id: 'E1', group_id: 'g1', date_ecriture: '2026-10-03', description: 'Dépôt espèces camp',
    amount_cents: 25050, type: 'transfert_interne', mode_transfert: 'depot_especes', status: 'draft',
    numero_piece: null, comptaweb_ecriture_id: null, ventilation_group_id: null,
    ligne_bancaire_id: 4242, ligne_bancaire_sous_index: null, libelle_origine: 'VERSEMENT ESPECES',
    justif_attendu: 1,
    ...over,
  };
  const cols = Object.keys(row);
  await testDb
    .prepare(`INSERT INTO ecritures (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(row));
}

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(client);
  await testDb.exec(SETUP_SQL);
  createEcriture.mockReset();
  createEcriture.mockResolvedValue({ dryRun: false, ecritureId: 9001, warnings: [] });
  bankLines.value = [];
});

describe('syncDraftToComptaweb — transfert interne', () => {
  it.each(['depot_especes', 'retrait_especes', 'transfert_especes'])(
    'mode %s : transfert interne sans imputation, puis miroir',
    async (mode) => {
      await insert({ mode_transfert: mode });
      const r = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1', { dryRun: false });
      expect(r).toMatchObject({ ok: true, dryRun: false, ecritureId: 9001 });

      expect(createEcriture).toHaveBeenCalledTimes(1);
      const [, input, opts] = createEcriture.mock.calls[0];
      expect(opts).toEqual({ dryRun: false });
      expect(input).toMatchObject({
        type: 'transfert_interne',
        modeTransfert: mode,
        libel: 'Dépôt espèces camp',
        dateecriture: '03/10/2026',
        montant: '250,50',
        numeropiece: 'E1',
        tiersCategId: '4',
        ventilations: [],
      });

      const row = await testDb
        .prepare("SELECT status, comptaweb_ecriture_id, numero_piece FROM ecritures WHERE id = 'E1'")
        .get();
      expect(row).toEqual({ status: 'mirror', comptaweb_ecriture_id: 9001, numero_piece: 'E1' });
    },
  );

  it('n° de pièce déjà posé (retrait lié) : envoyé tel quel', async () => {
    await insert({ mode_transfert: 'retrait_especes', numero_piece: 'CAI-7' });
    await syncDraftToComptaweb({ groupId: 'g1' }, 'E1', { dryRun: false });
    expect(createEcriture.mock.calls[0][1].numeropiece).toBe('CAI-7');
  });

  it('prévisualisation : rien n’est écrit', async () => {
    createEcriture.mockResolvedValue({ dryRun: true, warnings: [] });
    await insert({});
    const r = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1');
    expect(r).toMatchObject({ ok: true, dryRun: true });
    expect(createEcriture.mock.calls[0][2]).toEqual({ dryRun: true });
    const row = await testDb.prepare("SELECT status FROM ecritures WHERE id = 'E1'").get();
    expect(row).toEqual({ status: 'draft' });
  });

  it('sans mode : validation refusée, rien n’est envoyé', async () => {
    await insert({ mode_transfert: null });
    const r = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1', { dryRun: false });
    expect(r).toMatchObject({ ok: false, dryRun: false, missingFields: ['mode de transfert'] });
    expect(r.message).toMatch(/^Validation : mode de transfert/);
    expect(createEcriture).not.toHaveBeenCalled();
  });

  it('sans mode, en prévisualisation : signalé sans appel', async () => {
    await insert({ mode_transfert: null });
    const r = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1');
    expect(r).toMatchObject({ ok: false, dryRun: true, missingFields: ['mode de transfert'] });
    expect(createEcriture).not.toHaveBeenCalled();
  });

  it('déjà dans Comptaweb : refusé', async () => {
    await insert({ comptaweb_ecriture_id: 77 });
    const r = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1', { dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.missingFields).toEqual(['déjà créée dans Comptaweb (id 77)']);
    expect(createEcriture).not.toHaveBeenCalled();
  });

  it('ventilé : refusé (un transfert ne se ventile pas)', async () => {
    await insert({ ventilation_group_id: 'vg_1' });
    await insert({ id: 'E2', ventilation_group_id: 'vg_1', amount_cents: 100 });
    const r = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1', { dryRun: false });
    expect(r.missingFields).toEqual(['un transfert interne ne se ventile pas']);
    expect(createEcriture).not.toHaveBeenCalled();
  });
});

describe('scanDraftsFromComptaweb — transfert interne', () => {
  it('ne recale pas un transfert interne en recette, mais recale toujours un sens faux', async () => {
    bankLines.value = [
      { id: 4242, dateOperation: '2026-10-03', montantCentimes: 25050, intitule: 'VERSEMENT ESPECES', sousLignes: [] },
      { id: 4243, dateOperation: '2026-10-03', montantCentimes: 900, intitule: 'VIR FAMILLE', sousLignes: [] },
    ];
    await insert({ description: 'VERSEMENT ESPECES' });
    await insert({
      id: 'E2', ligne_bancaire_id: 4243, description: 'VIR FAMILLE', libelle_origine: 'VIR FAMILLE',
      type: 'depense', mode_transfert: null, amount_cents: 900,
    });

    const r = await scanDraftsFromComptaweb({ groupId: 'g1' }, testDb);
    expect(r.erreur).toBeUndefined();
    expect(r).toMatchObject({ crees: 0, existants: 1, corriges: 1 });

    const rows = await testDb.prepare('SELECT id, type, mode_transfert FROM ecritures ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'E1', type: 'transfert_interne', mode_transfert: 'depot_especes' },
      { id: 'E2', type: 'recette', mode_transfert: null },
    ]);
  });
});
