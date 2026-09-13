// Le test qui documente « septembre remonte » (ADR-039).
//
// Constat terrain du 2026-09-11 : depuis le 1er septembre, plus une seule
// ligne bancaire ni un seul brouillon. Cause — l'exercice est le contexte de la
// SESSION Comptaweb : le rapprochement bancaire lu en contexte 25/26 s'arrête
// au 31/08, et Baloo n'ouvrait que cette session-là.
//
// Ici, `scanDrafts` n'est PAS stubbé : la vraie `scanDraftsFromComptaweb`
// tourne, et c'est `listRapprochementBancaire` qui est faux — il renvoie des
// lignes DIFFÉRENTES selon la session reçue, exactement comme Comptaweb le fait
// selon l'exercice du contexte. On prouve donc l'effet de bout en bout : les
// lignes des DEUX exercices donnent lieu à des brouillons.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';

const dbRef: { value: DbWrapper | null } = { value: null };

// Lignes bancaires PAR SESSION : c'est le découpage par exercice de Comptaweb.
// La session 25/26 ne voit rien après le 31/08, la session 26/27 rien avant le
// 01/09 — d'où l'invisibilité de septembre quand on n'ouvre qu'une session.
const LIGNES_PAR_SESSION: Record<string, unknown[]> = {
  'c-34': [
    {
      id: 19200001,
      dateOperation: '2026-09-05',
      montantCentimes: -4200,
      intitule: 'CARTE 05/09 ALIMENTATION RENTREE',
      sousLignes: [],
    },
  ],
  'c-33': [
    {
      id: 19100002,
      dateOperation: '2026-08-24',
      montantCentimes: -9900,
      intitule: 'CARTE 24/08 INTENDANCE CAMP',
      sousLignes: [],
    },
  ],
};

vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));

// `scanDraftsFromComptaweb` écrit via getDb() : on le branche sur la BDD
// in-memory du test (le reste du module — wrapClient — reste le vrai).
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => dbRef.value };
});

vi.mock('../../comptaweb', () => ({
  // Ouvrir la session par défaut serait précisément le bug : on le rend visible.
  withAutoReLogin: vi.fn(async () => {
    throw new Error('session par défaut : le scan doit utiliser la session de l’exercice');
  }),
  listRapprochementBancaire: vi.fn(async (cfg: { cookie: string }) => ({
    ecrituresBancaires: LIGNES_PAR_SESSION[cfg.cookie] ?? [],
    ecrituresComptables: [],
  })),
  createEcriture: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
  scrapeListeEcritures: vi.fn(async () => ({ ecritures: [] })),
  scrapeEcritureDetail: vi.fn(async () => ({ ventilations: [] })),
}));

let compteurId = 0;
vi.mock('../../ids', () => ({
  nextId: async (prefix: string) => `${prefix}-2026-${++compteurId}`,
  nextIdOn: async (_db: unknown, prefix: string) => `${prefix}-2026-${++compteurId}`,
  currentTimestamp: () => '2026-09-13T08:00:00Z',
}));

import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema, ensureReconcileSchema } from '../../db/business-schema';
import { runSyncCycle } from '../sync-cycle';
import { withAutoReLogin, listRapprochementBancaire } from '../../comptaweb';
import type { ExerciceActif } from '../exercices-actifs';

const EX_2627: ExerciceActif = { code: '2026-2027', cwId: 34, debut: '2026-09-01', fin: '2027-08-31' };
const EX_2526: ExerciceActif = { code: '2025-2026', cwId: 33, debut: '2025-09-01', fin: '2026-08-31' };

const DDL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
    category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, carte_id TEXT, numero_piece TEXT,
    cw_numero_piece TEXT, status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER, libelle_origine TEXT,
    ventilation_group_id TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-09-13T08:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-09-13T08:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT, date_paiement TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT);
`;

describe('runSyncCycle — les brouillons de septembre remontent', () => {
  let db: DbWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    db = wrapClient(client);
    dbRef.value = db;
    await db.exec(DDL);
    await ensureSyncRunsSchema(db);
    await ensureReconcileSchema(db);
  });

  it('crée un brouillon depuis les lignes bancaires de CHAQUE exercice', async () => {
    const res = await runSyncCycle(db, 'g1', {
      trigger: 'manual',
      force: true,
      exercices: [EX_2627, EX_2526],
      loadConfigPourExercice: async (cwId) => ({ baseUrl: 'https://cw.test', cookie: `c-${cwId}` }),
      // `scanDrafts` volontairement NON injecté : c'est le vrai scan qui tourne.
      scrapeListe: async () => ({ ecritures: [] }),
      scrapeDetail: async () => ({ ventilations: [] }),
      resolveActiviteId: async () => null,
      resolveUniteId: async () => null,
      resolveCategoryId: async () => null,
    });

    expect(res.status).toBe('ok');
    expect(res.new_drafts).toBe(2);
    expect(res.exercices).toEqual(['2026-2027', '2025-2026']);

    // Le rapprochement a été lu une fois par exercice, dans SA session.
    expect(listRapprochementBancaire).toHaveBeenCalledWith({ baseUrl: 'https://cw.test', cookie: 'c-34' });
    expect(listRapprochementBancaire).toHaveBeenCalledWith({ baseUrl: 'https://cw.test', cookie: 'c-33' });
    // …et jamais dans la session par défaut, qui ne verrait pas septembre.
    expect(withAutoReLogin).not.toHaveBeenCalled();

    const rows = await db
      .prepare('SELECT date_ecriture, amount_cents, type, status FROM ecritures ORDER BY date_ecriture')
      .all<{ date_ecriture: string; amount_cents: number; type: string; status: string }>();

    expect(rows).toEqual([
      { date_ecriture: '2026-08-24', amount_cents: 9900, type: 'depense', status: 'draft' },
      { date_ecriture: '2026-09-05', amount_cents: 4200, type: 'depense', status: 'draft' },
    ]);
  });
});
