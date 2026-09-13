// Task 5 (ADR-039) : un cycle de sync couvre TOUS les exercices actifs, chacun
// avec sa propre session Comptaweb. Pendant la clôture (septembre), l'ancien
// exercice reçoit encore les dépenses de camp pendant que la rentrée alimente
// le nouveau — et l'exercice est un contexte de SESSION, pas un filtre.
//
// Réutilise le harnais de `sync-cycle.test.ts` (setupDb) plutôt que de le
// dupliquer intégralement. Ici on ne vérifie QUE le multi-exercice.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema, ensureReconcileSchema } from '../../db/business-schema';
import { runSyncCycle } from '../sync-cycle';
import type { ExerciceActif } from '../exercices-actifs';

// ---------------- Setup BDD (identique à sync-cycle.test.ts) ----------------

const ECRITURES_DDL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL,
    category_id TEXT,
    mode_paiement_id TEXT,
    activite_id TEXT,
    carte_id TEXT,
    numero_piece TEXT,
    cw_numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    comptaweb_ecriture_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE INDEX idx_ecritures_group ON ecritures(group_id);

  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT,
    obsolete_at TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
`;

async function setupDb(): Promise<{ client: Client; db: DbWrapper }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(ECRITURES_DDL);
  await ensureSyncRunsSchema(db);
  await ensureReconcileSchema(db);
  return { client, db };
}

const EX_2627: ExerciceActif = { code: '2026-2027', cwId: 34, debut: '2026-09-01', fin: '2027-08-31' };
const EX_2526: ExerciceActif = { code: '2025-2026', cwId: 33, debut: '2025-09-01', fin: '2026-08-31' };

const ligne = (cwId: number, date: string, montantCentimes: number) => ({
  id: cwId,
  numeroPiece: `ECR-${cwId}`,
  dateEcriture: date,
  type: 'depense' as const,
  intitule: `Ligne ${cwId}`,
  montantCentimes,
  compteBancaire: 'GROUPE VAL DE SAONE',
  modeTransaction: 'Carte',
  categorieTiers: '',
  structureTiers: '',
  rapproche: false,
});

describe('runSyncCycle — deux exercices', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    ({ db } = await setupDb());
  });

  it('lit les deux exercices en un seul run et importe des deux', async () => {
    const vues: number[] = [];

    const res = await runSyncCycle(db, 'g1', {
      trigger: 'manual',
      force: true,
      exercices: [EX_2627, EX_2526],
      loadConfigPourExercice: async (cwId) => ({ baseUrl: 'https://cw.test', cookie: `c-${cwId}` }),
      scrapeListe: async (cfg) => {
        const cwId = Number(cfg.cookie.replace('c-', ''));
        vues.push(cwId);
        return {
          ecritures: cwId === 34 ? [ligne(900, '2026-09-05', 1000)] : [ligne(800, '2026-08-24', 2000)],
        };
      },
      scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
      scrapeDetail: async (cwId) => ({
        ventilations: [{ montantCents: cwId === 900 ? 1000 : 2000, nature: null, activite: null, brancheprojet: null }],
      }),
      resolveActiviteId: async () => null,
      resolveUniteId: async () => null,
      resolveCategoryId: async () => null,
    });

    expect(vues.sort()).toEqual([33, 34]);
    expect(res.status).toBe('ok');
    expect(res.imported_from_cw).toBe(2);
    expect(res.exercices).toEqual(['2026-2027', '2025-2026']);

    const row = await db
      .prepare('SELECT exercices FROM sync_runs WHERE id = ?')
      .get<{ exercices: string | null }>(res.sync_run_id);
    expect(row?.exercices).toBe('2026-2027,2025-2026');
  });

  it('un exercice en échec n’empêche pas l’autre', async () => {
    const res = await runSyncCycle(db, 'g1', {
      trigger: 'manual',
      force: true,
      exercices: [EX_2627, EX_2526],
      loadConfigPourExercice: async (cwId) => {
        if (cwId === 33) throw new Error('Bascule non confirmée');
        return { baseUrl: 'https://cw.test', cookie: 'c-34' };
      },
      scrapeListe: async () => ({ ecritures: [ligne(900, '2026-09-05', 1000)] }),
      scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
      scrapeDetail: async () => ({ ventilations: [{ montantCents: 1000, nature: null, activite: null, brancheprojet: null }] }),
      resolveActiviteId: async () => null,
      resolveUniteId: async () => null,
      resolveCategoryId: async () => null,
    });

    expect(res.status).toBe('ok');
    expect(res.imported_from_cw).toBe(1); // 26/27 a bien abouti
    expect(res.error_message).toContain('2025-2026');
    expect(res.exercices).toEqual(['2026-2027']);
  });

  it('le budget de lectures détail est partagé, pas doublé', async () => {
    let fetches = 0;

    const res = await runSyncCycle(db, 'g1', {
      trigger: 'manual',
      force: true,
      maxDetailFetches: 2,
      exercices: [EX_2627, EX_2526],
      loadConfigPourExercice: async (cwId) => ({ baseUrl: 'https://cw.test', cookie: `c-${cwId}` }),
      scrapeListe: async (cfg) => {
        const cwId = Number(cfg.cookie.replace('c-', ''));
        return {
          ecritures:
            cwId === 34
              ? [ligne(901, '2026-09-05', 1000), ligne(902, '2026-09-06', 1100)]
              : [ligne(801, '2026-08-24', 2000), ligne(802, '2026-08-25', 2100)],
        };
      },
      scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
      scrapeDetail: async (cwId) => {
        fetches++;
        return { ventilations: [{ montantCents: cwId >= 900 ? 1000 : 2000, nature: null, activite: null, brancheprojet: null }] };
      },
      resolveActiviteId: async () => null,
      resolveUniteId: async () => null,
      resolveCategoryId: async () => null,
    });

    expect(fetches).toBe(2); // 2 au total, pas 2 par exercice
    expect(res.remaining).toBe(2); // le reste est drainé au cycle suivant
  });
});
