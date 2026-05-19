// Tests du service `createEcritureAndPushToCw` — flux miroir strict
// pour la création user-initiated d'une écriture comptable (Task 7
// du pivot phase 1).
//
// Flux attendu :
//   1. INSERT en BDD avec status='pending_cw' (snapshot du payload).
//   2. Appel scraper CW.
//   3a. Succès : UPDATE status='pending_sync', store cw_numero_piece.
//   3b. Échec  : UPDATE status='draft', exception propagée au caller.
//
// Pas de DELETE en cas d'erreur (cf. règle CLAUDE.md "JAMAIS de DELETE") :
// l'écriture reste en BDD sous forme de draft, ré-essayable manuellement
// ou via copier-coller dans CW.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper, type Statement } from '../../db';
import {
  createEcritureAndPushToCw,
  CwPushFailedError,
  CwLocalUpdateFailedError,
  type CwScraper,
  type EcriturePayload,
} from '../ecritures-create';

// Schéma minimal autonome pour le test : pas besoin de tirer tout
// business-schema (qui veut un environnement Next/libsql complet).
// Inclut les colonnes touchées par le flux (status, cw_numero_piece,
// comptaweb_ecriture_id) et les FK référencées dans le payload.
const SETUP_SQL = `
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
`;

const VALID_PAYLOAD: EcriturePayload = {
  date_ecriture: '2026-05-18',
  description: 'Achat fournitures bureau',
  amount_cents: 5000,
  type: 'depense',
  category_id: 'cat-1',
  mode_paiement_id: 'mp-1',
  unite_id: 'u-1',
  activite_id: 'act-1',
  carte_id: null,
  numero_piece: 'FACT-2026-001',
  notes: 'Notes du trésorier',
};

async function setupDb(): Promise<{ client: Client; db: ReturnType<typeof wrapClient> }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  await client.executeMultiple(SETUP_SQL);
  return { client, db: wrapClient(client) };
}

describe('createEcritureAndPushToCw', () => {
  let db: ReturnType<typeof wrapClient>;

  beforeEach(async () => {
    const setup = await setupDb();
    db = setup.db;
  });

  it('succès scraping : statut passe à pending_sync, cw_numero_piece stocké', async () => {
    const scraperMock: CwScraper = vi.fn().mockResolvedValue({
      cwNumeroPiece: 'CW-2026-001',
      cwEcritureId: 12345,
    });

    const result = await createEcritureAndPushToCw(db, {
      payload: VALID_PAYLOAD,
      group_id: 'g1',
      cwScraper: scraperMock,
      cwConfigLoader: async () => ({ baseUrl: 'http://localhost', cookie: 'fake' }),
    });

    expect(scraperMock).toHaveBeenCalledOnce();
    expect(result.status).toBe('pending_sync');
    expect(result.cw_numero_piece).toBe('CW-2026-001');
    expect(result.id).toMatch(/^DEP-/);

    const row = await db
      .prepare('SELECT status, cw_numero_piece, comptaweb_ecriture_id FROM ecritures WHERE id = ?')
      .get<{ status: string; cw_numero_piece: string | null; comptaweb_ecriture_id: number | null }>(result.id);
    expect(row?.status).toBe('pending_sync');
    expect(row?.cw_numero_piece).toBe('CW-2026-001');
    expect(row?.comptaweb_ecriture_id).toBe(12345);
  });

  it('échec scraping : statut rétrograde à draft, CwPushFailedError porteuse de ecritureId', async () => {
    const scraperMock: CwScraper = vi.fn().mockRejectedValue(new Error('CW down'));

    // Capture l'erreur typée pour vérifier qu'elle porte bien
    // l'ecritureId (évite la race condition de "requery du dernier
    // draft" côté caller).
    let caught: unknown;
    try {
      await createEcritureAndPushToCw(db, {
        payload: VALID_PAYLOAD,
        group_id: 'g1',
        cwScraper: scraperMock,
        cwConfigLoader: async () => ({ baseUrl: 'http://localhost', cookie: 'fake' }),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CwPushFailedError);
    const pushErr = caught as CwPushFailedError;
    expect(pushErr.message).toBe('CW down');
    expect(pushErr.ecritureId).toMatch(/^DEP-/);

    // L écriture EXISTE en BDD avec status='draft' (pas en pending_cw
    // perpétuel, pas DELETE) — l user peut la voir dans /inbox.
    const rows = await db
      .prepare('SELECT id, status, cw_numero_piece FROM ecritures')
      .all<{ id: string; status: string; cw_numero_piece: string | null }>();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('draft');
    expect(rows[0].cw_numero_piece).toBeNull();
    expect(rows[0].id).toBe(pushErr.ecritureId);
  });

  it('CW OK mais UPDATE local KO : CwLocalUpdateFailedError, PAS de rollback en draft (évite doublon CW)', async () => {
    // Scénario : le scraper réussit (CW a la donnée avec
    // `cw_numero_piece`) mais l'UPDATE local plante. Rétrograder en
    // `draft` ferait re-pusher l'user → doublon côté CW. La bonne
    // sémantique est de laisser `pending_cw` et de signaler explicitement
    // via `CwLocalUpdateFailedError`. La sync incrémentale Phase 2
    // ramassera l'écriture par cw_numero_piece et la promouvra.

    // On wrappe le `db` : tout prepare contenant "status = 'pending_sync'"
    // (l'UPDATE post-scraping) throw. Les autres prepares (nextIdOn,
    // INSERT pending_cw) passent normalement.
    const originalDb = db;
    const flakyDb: DbWrapper = {
      prepare(sql: string): Statement {
        if (sql.includes("status = 'pending_sync'")) {
          return {
            async run() {
              throw new Error('libsql network error');
            },
            async get() {
              throw new Error('libsql network error');
            },
            async all() {
              throw new Error('libsql network error');
            },
          };
        }
        return originalDb.prepare(sql);
      },
      exec: originalDb.exec.bind(originalDb),
      pragma: originalDb.pragma.bind(originalDb),
      transaction: originalDb.transaction.bind(originalDb),
    };

    const scraperMock: CwScraper = vi.fn().mockResolvedValue({
      cwNumeroPiece: 'CW-2026-XYZ',
      cwEcritureId: 999,
    });

    // Suppress console.error noise pour ce test (le service logue
    // volontairement la désynchro).
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let caught: unknown;
    try {
      await createEcritureAndPushToCw(flakyDb, {
        payload: VALID_PAYLOAD,
        group_id: 'g1',
        cwScraper: scraperMock,
        cwConfigLoader: async () => ({ baseUrl: 'http://localhost', cookie: 'fake' }),
      });
    } catch (err) {
      caught = err;
    }
    errorSpy.mockRestore();

    expect(caught).toBeInstanceOf(CwLocalUpdateFailedError);
    const localErr = caught as CwLocalUpdateFailedError;
    expect(localErr.ecritureId).toMatch(/^DEP-/);
    expect(localErr.cwNumeroPiece).toBe('CW-2026-XYZ');

    // L'écriture reste en `pending_cw` (pas en `draft`) : c'est volontaire,
    // évite le doublon CW au prochain retry. Sync Phase 2 promouvra.
    const row = await originalDb
      .prepare('SELECT id, status, cw_numero_piece FROM ecritures WHERE id = ?')
      .get<{ id: string; status: string; cw_numero_piece: string | null }>(localErr.ecritureId);
    expect(row?.status).toBe('pending_cw');
    // cw_numero_piece n'a pas été stocké (l'UPDATE a planté), mais
    // l'erreur typée le porte pour audit / arbitrage humain.
    expect(row?.cw_numero_piece).toBeNull();
  });

  it('persist tous les champs du payload dans la ligne BDD', async () => {
    const scraperMock: CwScraper = vi.fn().mockResolvedValue({
      cwNumeroPiece: 'CW-2026-002',
    });

    const result = await createEcritureAndPushToCw(db, {
      payload: VALID_PAYLOAD,
      group_id: 'g1',
      cwScraper: scraperMock,
      cwConfigLoader: async () => ({ baseUrl: 'http://localhost', cookie: 'fake' }),
    });

    const row = await db
      .prepare('SELECT * FROM ecritures WHERE id = ?')
      .get<Record<string, unknown>>(result.id);
    expect(row).toMatchObject({
      id: result.id,
      group_id: 'g1',
      date_ecriture: '2026-05-18',
      description: 'Achat fournitures bureau',
      amount_cents: 5000,
      type: 'depense',
      category_id: 'cat-1',
      mode_paiement_id: 'mp-1',
      unite_id: 'u-1',
      activite_id: 'act-1',
      numero_piece: 'FACT-2026-001',
      notes: 'Notes du trésorier',
      status: 'pending_sync',
      cw_numero_piece: 'CW-2026-002',
    });
  });

  it('idempotence sur erreur : 2 relances génèrent 2 écritures distinctes (pas de retry magique)', async () => {
    const scraperMock: CwScraper = vi.fn().mockRejectedValue(new Error('CW down'));

    await expect(
      createEcritureAndPushToCw(db, {
        payload: VALID_PAYLOAD,
        group_id: 'g1',
        cwScraper: scraperMock,
        cwConfigLoader: async () => ({ baseUrl: 'http://localhost', cookie: 'fake' }),
      }),
    ).rejects.toThrow();

    await expect(
      createEcritureAndPushToCw(db, {
        payload: VALID_PAYLOAD,
        group_id: 'g1',
        cwScraper: scraperMock,
        cwConfigLoader: async () => ({ baseUrl: 'http://localhost', cookie: 'fake' }),
      }),
    ).rejects.toThrow();

    const rows = await db
      .prepare('SELECT id FROM ecritures ORDER BY id')
      .all<{ id: string }>();
    expect(rows.length).toBe(2);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it('utilise le prefix REC pour les recettes', async () => {
    const scraperMock: CwScraper = vi.fn().mockResolvedValue({
      cwNumeroPiece: 'CW-R-001',
    });
    const result = await createEcritureAndPushToCw(db, {
      payload: { ...VALID_PAYLOAD, type: 'recette' },
      group_id: 'g1',
      cwScraper: scraperMock,
      cwConfigLoader: async () => ({ baseUrl: 'http://localhost', cookie: 'fake' }),
    });
    expect(result.id).toMatch(/^REC-/);
  });

  it('marque comptaweb_synced=0 même en pending_sync (vrai miroir = status mirror seulement)', async () => {
    // pending_sync = envoyé à CW mais pas encore confirmé par la sync
    // incrémentale. Le bool comptaweb_synced reste 0 tant que la promo
    // vers `mirror` n'a pas eu lieu (cf. spec : la sync Phase 2 fera le
    // match par cw_numero_piece et UPDATE status=mirror, comptaweb_synced=1).
    const scraperMock: CwScraper = vi.fn().mockResolvedValue({
      cwNumeroPiece: 'CW-2026-003',
    });
    const result = await createEcritureAndPushToCw(db, {
      payload: VALID_PAYLOAD,
      group_id: 'g1',
      cwScraper: scraperMock,
      cwConfigLoader: async () => ({ baseUrl: 'http://localhost', cookie: 'fake' }),
    });
    const row = await db
      .prepare('SELECT comptaweb_synced FROM ecritures WHERE id = ?')
      .get<{ comptaweb_synced: number }>(result.id);
    expect(row?.comptaweb_synced).toBe(0);
  });
});
