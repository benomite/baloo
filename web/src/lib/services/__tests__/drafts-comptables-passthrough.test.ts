// scanDraftsFromComptaweb doit exposer les écritures comptables non rapprochées
// (data.ecrituresComptables), pour que la sync importe les transferts hors résultat.
import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

const dataRef: { value: unknown } = { value: { ecrituresBancaires: [], ecrituresComptables: [] } };
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async () => dataRef.value,
  listRapprochementBancaire: vi.fn(),
  createEcriture: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-1`,
  currentTimestamp: () => '2026-07-03T00:00:00Z',
}));

import { scanDraftsFromComptaweb } from '../drafts';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, unite_id TEXT, date_ecriture TEXT,
      description TEXT, amount_cents INTEGER, type TEXT, category_id TEXT, mode_paiement_id TEXT,
      activite_id TEXT, numero_piece TEXT, status TEXT, justif_attendu INTEGER, comptaweb_synced INTEGER,
      ligne_bancaire_id INTEGER, ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER,
      carte_id TEXT, libelle_origine TEXT, ventilation_group_id TEXT, notes TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT);
    CREATE TABLE depots_justificatifs (id TEXT, ecriture_id TEXT);
    CREATE TABLE remboursements (id TEXT, ecriture_id TEXT);
    CREATE TABLE modes_paiement (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE cartes (id TEXT, group_id TEXT, code_externe TEXT, statut TEXT);
  `);
  return db;
}

describe('scanDraftsFromComptaweb — expose ecrituresComptables', () => {
  it('renvoie les écritures comptables non rapprochées telles quelles', async () => {
    const db = await setup();
    dataRef.value = {
      ecrituresBancaires: [],
      ecrituresComptables: [{
        id: 2403659, dateEcriture: '2026-06-01', type: 'Dépense', intitule: 'Regroupement...',
        devise: 'EUR', montantCentimes: -15900, numeroPiece: '', modeTransaction: 'Virement', tiers: 'Echelon National',
      }],
    };
    const res = await scanDraftsFromComptaweb({ groupId: 'g' }, db);
    expect(res.ecrituresComptables).toHaveLength(1);
    expect(res.ecrituresComptables?.[0].id).toBe(2403659);
  });
});
