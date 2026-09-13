// Le rapprochement bancaire est découpé par exercice : côté Comptaweb,
// l'exercice est le contexte de la SESSION (ADR-039). `scanDraftsFromComptaweb`
// doit donc pouvoir lire les lignes bancaires dans la session d'un exercice
// donné, au lieu d'ouvrir systématiquement la sienne (session `default`, posée
// sur l'exercice non clôturé) — sans quoi les lignes de septembre restent
// invisibles et aucun brouillon n'est créé (constat terrain 2026-09-11).
//
// L'ajout est ADDITIF : sans config, le comportement historique
// (`withAutoReLogin`) est strictement inchangé.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

const VIDE = { ecrituresBancaires: [], ecrituresComptables: [] };

vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: vi.fn(async () => VIDE),
  listRapprochementBancaire: vi.fn(async () => VIDE),
  createEcriture: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-1`,
  currentTimestamp: () => '2026-09-13T00:00:00Z',
}));

import { scanDraftsFromComptaweb } from '../drafts';
import { withAutoReLogin, listRapprochementBancaire } from '../../comptaweb';

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
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
    CREATE TABLE depots_justificatifs (id TEXT, ecriture_id TEXT);
    CREATE TABLE remboursements (id TEXT, ecriture_id TEXT);
    CREATE TABLE modes_paiement (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE cartes (id TEXT, group_id TEXT, code_externe TEXT, statut TEXT);
  `);
  return db;
}

describe('scanDraftsFromComptaweb — session de l’exercice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lit le rapprochement dans la session fournie, sans ouvrir la sienne', async () => {
    const db = await setup();
    const config = { baseUrl: 'https://cw.test', cookie: 'session-2026-2027' };

    const res = await scanDraftsFromComptaweb({ groupId: 'g1' }, db, { config });

    expect(listRapprochementBancaire).toHaveBeenCalledWith(config);
    expect(withAutoReLogin).not.toHaveBeenCalled();
    expect(res.erreur).toBeUndefined();
  });

  it('sans config, garde le comportement historique (session par défaut)', async () => {
    const db = await setup();

    const res = await scanDraftsFromComptaweb({ groupId: 'g1' }, db);

    expect(withAutoReLogin).toHaveBeenCalled();
    expect(listRapprochementBancaire).not.toHaveBeenCalled();
    expect(res.erreur).toBeUndefined();
  });
});
