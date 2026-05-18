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
import { wrapClient } from '../../db';
import {
  createEcritureAndPushToCw,
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
  let client: Client;
  let db: ReturnType<typeof wrapClient>;

  beforeEach(async () => {
    const setup = await setupDb();
    client = setup.client;
    db = setup.db;
  });

  it('succès scraping : statut passe à pending_sync, cw_numero_piece stocké', async () => {
    void client;
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

  it('échec scraping : statut rétrograde à draft, exception propagée, BDD cohérente', async () => {
    const scraperMock: CwScraper = vi.fn().mockRejectedValue(new Error('CW down'));

    await expect(
      createEcritureAndPushToCw(db, {
        payload: VALID_PAYLOAD,
        group_id: 'g1',
        cwScraper: scraperMock,
        cwConfigLoader: async () => ({ baseUrl: 'http://localhost', cookie: 'fake' }),
      }),
    ).rejects.toThrow('CW down');

    // L écriture EXISTE en BDD avec status='draft' (pas en pending_cw
    // perpétuel, pas DELETE) — l user peut la voir dans /inbox.
    const rows = await db
      .prepare('SELECT id, status, cw_numero_piece FROM ecritures')
      .all<{ id: string; status: string; cw_numero_piece: string | null }>();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('draft');
    expect(rows[0].cw_numero_piece).toBeNull();
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
