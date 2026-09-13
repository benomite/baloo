// `resyncEcritureDetail` doit lire le détail dans la session de l'exercice de
// SON écriture (ADR-039, constat de relecture 2026-09-13).
//
// C'était le dernier chemin qui supposait un exercice unique : il lisait le
// détail avec `loadConfig()` (session `default`). Sur une écriture de l'autre
// exercice, le scrape échouait, `resolveVentilations` avalait l'erreur et
// renvoyait `ventilations: []` — donc aucune donnée perdue, mais le bouton
// « resynchroniser » du panneau d'écriture restait SILENCIEUSEMENT inopérant
// sur la moitié des écritures pendant toute la clôture.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import type { ComptawebConfig } from '../../comptaweb/types';

const EX_2526 = { code: '2025-2026', cwId: 33, debut: '2025-09-01', fin: '2026-08-31' };

vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
// `logError` persiste en BDD en fire-and-forget : on l'isole pour ne pas
// toucher la base réelle depuis un test, et garder une sortie propre.
vi.mock('../../log', () => ({ logError: vi.fn() }));
vi.mock('../exercice-pour-ecriture', () => ({
  resoudreExercicePourDate: vi.fn(async () => EX_2526),
}));
vi.mock('../../comptaweb/auth', () => ({
  // Ouvrir la session par défaut est précisément le bug : on le rend visible.
  loadConfig: vi.fn(async () => {
    throw new Error('session par défaut : le détail doit être lu dans la session de l’exercice');
  }),
  loadConfigPourExercice: vi.fn(),
  withAutoReLogin: vi.fn(),
  withComptaweb: vi.fn(async (cwId: number, fn: (c: ComptawebConfig) => Promise<unknown>) =>
    fn({ baseUrl: 'https://cw.test', cookie: `c-${cwId}` }),
  ),
}));
vi.mock('../../comptaweb', () => ({
  scrapeListeEcritures: vi.fn(),
  scrapeEcritureDetail: vi.fn(async (cfg: ComptawebConfig) => ({
    ventilations:
      cfg.cookie === 'c-33'
        ? [{ montantCents: 49100, nature: 'Dons', activite: 'WET', brancheprojet: 'Groupe' }]
        : [],
  })),
  ComptawebSessionExpiredError: class extends Error {},
}));

import { resyncEcritureDetail } from '../sync-cycle';
import { resoudreExercicePourDate } from '../exercice-pour-ecriture';
import { withComptaweb } from '../../comptaweb/auth';
import { scrapeEcritureDetail } from '../../comptaweb';

const DDL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
    category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, carte_id TEXT, numero_piece TEXT,
    cw_numero_piece TEXT, status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER, cw_signature TEXT,
    libelle_origine TEXT, ventilation_group_id TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-08-24T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-08-24T00:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT, date_paiement TEXT);
`;

describe('resyncEcritureDetail — routage par l’exercice de l’écriture', () => {
  let db: DbWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    db = wrapClient(client);
    await db.exec(DDL);
    // Une écriture d'AOÛT (exercice 25/26), reliée à CW.
    await db
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
           status, comptaweb_ecriture_id, comptaweb_synced)
         VALUES ('ECR-AOUT', 'g1', '2026-08-24', 'Intendance camp', 49100, 'depense',
           'mirror', 2390826, 1)`,
      )
      .run();
  });

  it('lit le détail dans la session de l’exercice de la date, pas dans la session par défaut', async () => {
    // Seuls les résolveurs de référentiels sont injectés (les tables de
    // référence ne sont pas dans ce DDL minimal) : le routage, lui, n'est PAS
    // court-circuité — ni `loadConfig`, ni `scrapeDetail`.
    const res = await resyncEcritureDetail(db, 'g1', 'ECR-AOUT', {
      resolveActiviteId: async () => 'ACT-WET',
      resolveUniteId: async () => 'UNITE-GR',
      resolveCategoryId: async () => 'CAT-DONS',
    });

    expect(res).toEqual({ ok: true, updated: 1, created: 0, orphaned: 0 });
    // Routage par la date de l'écriture…
    expect(resoudreExercicePourDate).toHaveBeenCalledWith('g1', '2026-08-24');
    // …puis lecture dans la session de CET exercice.
    expect(vi.mocked(withComptaweb).mock.calls[0][0]).toBe(33);
    expect(vi.mocked(scrapeEcritureDetail).mock.calls[0][0]).toMatchObject({ cookie: 'c-33' });

    // L'imputation lue via la bonne session est bien appliquée.
    const ecr = await db
      .prepare("SELECT activite_id, category_id, unite_id FROM ecritures WHERE id = 'ECR-AOUT'")
      .get<{ activite_id: string | null; category_id: string | null; unite_id: string | null }>();
    expect(ecr).toEqual({ activite_id: 'ACT-WET', category_id: 'CAT-DONS', unite_id: 'UNITE-GR' });
  });

  it('une injection `loadConfig` (tests, appels legacy) court-circuite le routage', async () => {
    const res = await resyncEcritureDetail(db, 'g1', 'ECR-AOUT', {
      loadConfig: async () => ({ baseUrl: 'https://cw.test', cookie: 'injectee' }),
      scrapeDetail: async () => ({
        ventilations: [{ montantCents: 49100, nature: null, activite: null, brancheprojet: null }],
      }),
    });

    expect(res).toEqual({ ok: true, updated: 1, created: 0, orphaned: 0 });
    expect(resoudreExercicePourDate).not.toHaveBeenCalled();
    expect(withComptaweb).not.toHaveBeenCalled();
  });
});
