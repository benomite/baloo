import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureReconcileSchema } from '../../db/business-schema';
import {
  restoreSupprimeeToDraft,
  deleteArbitratedEcriture,
  deleteAllArbitrated,
  confirmLink,
  rejectLink,
} from '../ecritures-arbitrage';
import { upsertSuggestion, listSuggestions } from '../cw-link-suggestions';

const SATELLITE_DDL = `
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE avances_camp (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE inbox_suggestion_rejets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL,
    ecriture_id TEXT NOT NULL, target_kind TEXT NOT NULL DEFAULT 'depot',
    target_id TEXT NOT NULL
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_ecriture TEXT NOT NULL,
      description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
      cw_numero_piece TEXT, comptaweb_ecriture_id INTEGER, cw_signature TEXT,
      comptaweb_synced INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft', updated_at TEXT
    );
    ${SATELLITE_DDL}
  `);
  await ensureReconcileSchema(db);
  return db;
}

async function insertEcr(db: DbWrapper, id: string, status: string, over: Record<string, unknown> = {}) {
  const e = { group_id: 'g1', date_ecriture: '2026-04-01', description: 'x', amount_cents: 1000, type: 'depense', ...over };
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status) VALUES (?,?,?,?,?,?,?)`,
    )
    .run(id, e.group_id, e.date_ecriture, e.description, e.amount_cents, e.type, status);
}

describe('restoreSupprimeeToDraft', () => {
  let db: DbWrapper;
  beforeEach(async () => { db = await setupDb(); });

  it('repasse une supprimee_cw en draft', async () => {
    await insertEcr(db, 'E1', 'supprimee_cw', { comptaweb_ecriture_id: 42 });
    const res = await restoreSupprimeeToDraft('g1', 'E1', db);
    expect(res.ok).toBe(true);
    const r = await db.prepare('SELECT status, comptaweb_ecriture_id FROM ecritures WHERE id=?').get<{ status: string; comptaweb_ecriture_id: number | null }>('E1');
    expect(r?.status).toBe('draft');
    expect(r?.comptaweb_ecriture_id ?? null).toBeNull();
  });

  it('refuse si pas supprimee_cw', async () => {
    await insertEcr(db, 'E1', 'mirror');
    const res = await restoreSupprimeeToDraft('g1', 'E1', db);
    expect(res).toEqual({ ok: false, reason: 'wrong_status' });
  });
});

describe('deleteArbitratedEcriture', () => {
  let db: DbWrapper;
  beforeEach(async () => { db = await setupDb(); });

  it('supprime une supprimee_cw sans pièce', async () => {
    await insertEcr(db, 'E1', 'supprimee_cw');
    const res = await deleteArbitratedEcriture('g1', 'E1', db);
    expect(res.ok).toBe(true);
    const r = await db.prepare('SELECT id FROM ecritures WHERE id=?').get('E1');
    expect(r).toBeUndefined();
  });

  it('refuse si une pièce est attachée', async () => {
    await insertEcr(db, 'E1', 'supprimee_cw');
    await db.prepare("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('J1','ecriture','E1')").run();
    const res = await deleteArbitratedEcriture('g1', 'E1', db);
    expect(res).toEqual({ ok: false, reason: 'has_attachments' });
    const r = await db.prepare('SELECT id FROM ecritures WHERE id=?').get('E1');
    expect(r).toBeTruthy();
  });

  it('refuse si pas supprimee_cw', async () => {
    await insertEcr(db, 'E1', 'mirror');
    const res = await deleteArbitratedEcriture('g1', 'E1', db);
    expect(res).toEqual({ ok: false, reason: 'wrong_status' });
  });

  it('nettoie le marqueur « Ignorer » (inbox_suggestion_rejets) puis supprime', async () => {
    await insertEcr(db, 'E1', 'agrege_remplace');
    await db.prepare("INSERT INTO inbox_suggestion_rejets (group_id, ecriture_id, target_id) VALUES ('g1','E1','D1')").run();
    const res = await deleteArbitratedEcriture('g1', 'E1', db);
    expect(res.ok).toBe(true);
    expect(await db.prepare('SELECT id FROM ecritures WHERE id=?').get('E1')).toBeUndefined();
    const rejet = await db.prepare("SELECT COUNT(*) n FROM inbox_suggestion_rejets WHERE ecriture_id='E1'").get<{ n: number }>();
    expect(rejet?.n).toBe(0);
  });

  it('refuse si un dépôt espèces est rattaché (FK non couverte avant)', async () => {
    await insertEcr(db, 'E1', 'agrege_remplace');
    await db.prepare("INSERT INTO depots_especes (id, ecriture_id) VALUES ('DE1','E1')").run();
    const res = await deleteArbitratedEcriture('g1', 'E1', db);
    expect(res).toEqual({ ok: false, reason: 'has_attachments' });
  });

  it('refuse si une avance de camp est rattachée', async () => {
    await insertEcr(db, 'E1', 'agrege_remplace');
    await db.prepare("INSERT INTO avances_camp (id, ecriture_id) VALUES ('AVC1','E1')").run();
    const res = await deleteArbitratedEcriture('g1', 'E1', db);
    expect(res).toEqual({ ok: false, reason: 'has_attachments' });
  });

  it('ne plante PAS sur la FK NOT NULL du marqueur « Ignorer » (FK activées)', async () => {
    // Repro réelle du crash : avec les FK SQLite activées, le DELETE échouait
    // sur inbox_suggestion_rejets.ecriture_id (NOT NULL). Le nettoyage préalable
    // doit faire passer la suppression.
    const client: Client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = ON');
    const fkDb = wrapClient(client);
    await fkDb.exec(`
      CREATE TABLE ecritures (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_ecriture TEXT NOT NULL,
        description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft', updated_at TEXT
      );
      CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT);
      CREATE TABLE inbox_suggestion_rejets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL,
        ecriture_id TEXT NOT NULL REFERENCES ecritures(id),
        target_kind TEXT NOT NULL DEFAULT 'depot', target_id TEXT NOT NULL
      );
    `);
    await fkDb.prepare("INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status) VALUES ('E1','g1','2026-04-01','x',1000,'depense','agrege_remplace')").run();
    await fkDb.prepare("INSERT INTO inbox_suggestion_rejets (group_id, ecriture_id, target_id) VALUES ('g1','E1','D1')").run();
    const res = await deleteArbitratedEcriture('g1', 'E1', fkDb);
    expect(res.ok).toBe(true);
    expect(await fkDb.prepare('SELECT id FROM ecritures WHERE id=?').get('E1')).toBeUndefined();
  });
});

describe('deleteAllArbitrated (batch)', () => {
  let db: DbWrapper;
  beforeEach(async () => { db = await setupDb(); });

  it('supprime tous les doublons sans pièce et ignore ceux qui en ont une', async () => {
    await insertEcr(db, 'A1', 'agrege_remplace');
    await insertEcr(db, 'A2', 'agrege_remplace');
    await insertEcr(db, 'A3', 'agrege_remplace');
    await db.prepare("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('J1','ecriture','A3')").run();
    await insertEcr(db, 'M1', 'mirror'); // ne doit pas être touchée
    const res = await deleteAllArbitrated('g1', 'agrege_remplace', db);
    expect(res).toEqual({ ok: true, deleted: 2, skipped: 1 });
    const rest = await db.prepare("SELECT COUNT(*) n FROM ecritures WHERE status='agrege_remplace'").get<{ n: number }>();
    expect(rest?.n).toBe(1); // A3 (avec justif) conservée
    expect(await db.prepare("SELECT id FROM ecritures WHERE id='M1'").get('M1')).toBeTruthy();
  });

  it('liste vide → 0 supprimé', async () => {
    const res = await deleteAllArbitrated('g1', 'agrege_remplace', db);
    expect(res).toEqual({ ok: true, deleted: 0, skipped: 0 });
  });
});

describe('confirmLink / rejectLink', () => {
  let db: DbWrapper;
  beforeEach(async () => { db = await setupDb(); });

  it('confirme : pose la clé stable + mirror + signature nulle', async () => {
    await insertEcr(db, 'D1', 'draft', { amount_cents: 2400 });
    const id = await upsertSuggestion(db, { groupId: 'g1', ecritureId: 'D1', cwEcritureId: 900, cwNumeroPiece: 'ECR-900', cwMontantCents: 2400, cwDate: '2026-04-02', cwIntitule: 'Depuis CW' });
    const res = await confirmLink('g1', id!, db);
    expect(res.ok).toBe(true);
    const r = await db.prepare('SELECT status, comptaweb_ecriture_id, cw_signature, description FROM ecritures WHERE id=?').get<{ status: string; comptaweb_ecriture_id: number; cw_signature: string | null; description: string }>('D1');
    expect(r?.status).toBe('mirror');
    expect(r?.comptaweb_ecriture_id).toBe(900);
    expect(r?.cw_signature ?? null).toBeNull();
    expect(r?.description).toBe('Depuis CW');
    expect(await listSuggestions(db, 'g1', 'a_confirmer')).toHaveLength(0);
  });

  it('confirme : rejette les autres suggestions ouvertes du même draft', async () => {
    await insertEcr(db, 'D1', 'draft', { amount_cents: 2400 });
    const id1 = await upsertSuggestion(db, { groupId: 'g1', ecritureId: 'D1', cwEcritureId: 900 });
    await upsertSuggestion(db, { groupId: 'g1', ecritureId: 'D1', cwEcritureId: 901 });
    await confirmLink('g1', id1!, db);
    expect(await listSuggestions(db, 'g1', 'a_confirmer')).toHaveLength(0);
    expect(await listSuggestions(db, 'g1', 'rejete')).toHaveLength(1);
  });

  it('rejette une suggestion', async () => {
    await insertEcr(db, 'D1', 'draft');
    const id = await upsertSuggestion(db, { groupId: 'g1', ecritureId: 'D1', cwEcritureId: 900 });
    const res = await rejectLink('g1', id!, db);
    expect(res.ok).toBe(true);
    expect(await listSuggestions(db, 'g1', 'a_confirmer')).toHaveLength(0);
    expect(await listSuggestions(db, 'g1', 'rejete')).toHaveLength(1);
  });
});
