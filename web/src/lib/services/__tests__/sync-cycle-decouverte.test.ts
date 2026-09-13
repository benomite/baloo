// Le chemin RÉEL de découverte des exercices (ADR-039, constat de relecture
// 2026-09-13) : croisement de la liste Comptaweb et du réglage de groupe
// `dernier_exercice_clos`. Les autres tests de la boucle injectent tous
// `exercices` et ne le couvrent donc pas — or c'est le seul filet du réglage
// « dernier exercice clos » : sans lui, rien ne garantit qu'un exercice déclaré
// clos est réellement exclu de la boucle.
//
// La date est figée : `decouvrirExercices` lit l'horloge réelle (via
// `exercicesActifs`), et un test qui en dépend pourrirait au 01/09/2027.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema, ensureReconcileSchema } from '../../db/business-schema';

const groupeRef: { value: { dernier_exercice_clos: string | null } } = {
  value: { dernier_exercice_clos: null },
};

vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb/exercices', () => ({
  fetchExercices: vi.fn(async () => ({
    contexteCwId: 33,
    options: [
      { cwId: 34, libelle: 'Sept 2026 - Août 2027' },
      { cwId: 33, libelle: 'Sept 2025 - Août 2026' },
    ],
    csrfToken: 'tok',
    actionPath: '/exercice/upd?id=33',
  })),
}));
vi.mock('../groupes', () => ({
  getGroupe: vi.fn(async () => groupeRef.value),
}));
vi.mock('../../comptaweb/auth', () => ({
  loadConfig: vi.fn(),
  loadConfigPourExercice: vi.fn(async (cwId: number) => ({
    baseUrl: 'https://cw.test',
    cookie: `c-${cwId}`,
  })),
  withAutoReLogin: vi.fn(async (fn: (c: unknown) => Promise<unknown>) =>
    fn({ baseUrl: 'https://cw.test', cookie: 'default' }),
  ),
}));

import { runSyncCycle } from '../sync-cycle';
import { fetchExercices } from '../../comptaweb/exercices';

const DDL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
    category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, carte_id TEXT, numero_piece TEXT,
    cw_numero_piece TEXT, status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER,
    libelle_origine TEXT, ventilation_group_id TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-09-13T08:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-09-13T08:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT, date_paiement TEXT);
`;

/** Options communes : tout le reste du cycle est neutralisé, on n'observe
 *  QUE les sessions ouvertes, donc les exercices retenus par la découverte. */
function optsAvecSessionsObservees(sessions: string[]) {
  return {
    trigger: 'manual' as const,
    force: true,
    // ni `exercices` ni `loadConfig` : c'est la vraie découverte qui décide.
    scrapeListe: async (cfg: { cookie: string }) => {
      sessions.push(cfg.cookie);
      return { ecritures: [] };
    },
    scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
    scrapeDetail: async () => ({ ventilations: [] }),
    resolveActiviteId: async () => null,
    resolveUniteId: async () => null,
    resolveCategoryId: async () => null,
  };
}

describe('runSyncCycle — découverte réelle des exercices', () => {
  let db: DbWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));
    groupeRef.value = { dernier_exercice_clos: null };
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    db = wrapClient(client);
    await db.exec(DDL);
    await ensureSyncRunsSchema(db);
    await ensureReconcileSchema(db);
  });

  afterEach(() => vi.useRealTimers());

  it('un exercice déclaré clos est exclu : un seul tour', async () => {
    groupeRef.value = { dernier_exercice_clos: '2025-2026' };
    const sessions: string[] = [];

    const res = await runSyncCycle(db, 'g1', optsAvecSessionsObservees(sessions));

    expect(fetchExercices).toHaveBeenCalled(); // la liste CW est bien lue
    expect(res.status).toBe('ok');
    expect(res.exercices).toEqual(['2026-2027']);
    expect(sessions).toEqual(['c-34']); // 25/26 jamais ouvert
  });

  it('sans réglage de clôture, les deux exercices actifs sont couverts', async () => {
    const sessions: string[] = [];

    const res = await runSyncCycle(db, 'g1', optsAvecSessionsObservees(sessions));

    expect(res.status).toBe('ok');
    expect(res.exercices).toEqual(['2026-2027', '2025-2026']);
    expect(sessions).toEqual(['c-34', 'c-33']); // le plus récent d'abord
  });
});
