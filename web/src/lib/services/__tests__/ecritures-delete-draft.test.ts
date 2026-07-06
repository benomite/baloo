// Tests du service `deleteDraftEcriture` — suppression d'un brouillon local.
//
// Contexte : un draft (status='draft') est une écriture purement locale,
// jamais envoyée à Comptaweb. C'est la SEULE écriture qu'un utilisateur peut
// supprimer (exception assumée à la règle "JAMAIS de DELETE sur ecritures" du
// CLAUDE.md : pas de pièce attachée, pas d'équivalent CW à désynchroniser).
//
// Garde-fous testés ici :
//   - supprime un draft nu (sans justif/dépôt/remb) ;
//   - REFUSE tout statut ≠ 'draft' (pending_cw/pending_sync/mirror/divergent) ;
//   - REFUSE un draft avec justif, dépôt justif, ou remboursement attaché ;
//   - REFUSE une écriture d'un autre groupe ou hors scope unité (chef).

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { deleteDraftEcriture } from '../ecritures';

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT '2026-05-31T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-05-31T00:00:00Z'
  );
  CREATE TABLE justificatifs (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL
  );
  CREATE TABLE depots_justificatifs (
    id TEXT PRIMARY KEY,
    ecriture_id TEXT
  );
  CREATE TABLE remboursements (
    id TEXT PRIMARY KEY,
    ecriture_id TEXT
  );
`;

async function setupDb(): Promise<{ client: Client; db: DbWrapper }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return { client, db };
}

async function insertEcriture(
  db: DbWrapper,
  overrides: Partial<{ id: string; group_id: string; unite_id: string | null; status: string }> = {},
) {
  const e = {
    id: 'ECR-2026-207',
    group_id: 'val-de-saone',
    unite_id: null as string | null,
    status: 'draft',
    ...overrides,
  };
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, unite_id, date_ecriture, description, amount_cents, type, status)
       VALUES (?, ?, ?, '2026-04-07', 'WE pio 04/2026', 10537, 'depense', ?)`,
    )
    .run(e.id, e.group_id, e.unite_id, e.status);
  return e;
}

async function countEcritures(db: DbWrapper, id: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as n FROM ecritures WHERE id = ?').get<{ n: number }>(id);
  return row?.n ?? 0;
}

const CTX = { groupId: 'val-de-saone' };

describe('deleteDraftEcriture', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    ({ db } = await setupDb());
  });

  it('supprime un draft nu (sans justif/dépôt/remb)', async () => {
    await insertEcriture(db, { status: 'draft' });
    const res = await deleteDraftEcriture(CTX, 'ECR-2026-207', db);
    expect(res).toEqual({ ok: true });
    expect(await countEcritures(db, 'ECR-2026-207')).toBe(0);
  });

  it.each(['pending_cw', 'pending_sync', 'mirror', 'divergent'])(
    'REFUSE la suppression d\'une écriture en statut %s (pas un draft)',
    async (status) => {
      await insertEcriture(db, { status });
      const res = await deleteDraftEcriture(CTX, 'ECR-2026-207', db);
      expect(res).toEqual({ ok: false, reason: 'not_draft' });
      expect(await countEcritures(db, 'ECR-2026-207')).toBe(1);
    },
  );

  it('REFUSE un draft avec un justificatif attaché', async () => {
    await insertEcriture(db, { status: 'draft' });
    await db
      .prepare(`INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('J1', 'ecriture', 'ECR-2026-207')`)
      .run();
    const res = await deleteDraftEcriture(CTX, 'ECR-2026-207', db);
    expect(res).toEqual({ ok: false, reason: 'has_attachments' });
    expect(await countEcritures(db, 'ECR-2026-207')).toBe(1);
  });

  it('REFUSE un draft avec un dépôt de justificatif attaché', async () => {
    await insertEcriture(db, { status: 'draft' });
    await db.prepare(`INSERT INTO depots_justificatifs (id, ecriture_id) VALUES ('D1', 'ECR-2026-207')`).run();
    const res = await deleteDraftEcriture(CTX, 'ECR-2026-207', db);
    expect(res).toEqual({ ok: false, reason: 'has_attachments' });
    expect(await countEcritures(db, 'ECR-2026-207')).toBe(1);
  });

  it('REFUSE un draft avec un remboursement attaché', async () => {
    await insertEcriture(db, { status: 'draft' });
    await db.prepare(`INSERT INTO remboursements (id, ecriture_id) VALUES ('R1', 'ECR-2026-207')`).run();
    const res = await deleteDraftEcriture(CTX, 'ECR-2026-207', db);
    expect(res).toEqual({ ok: false, reason: 'has_attachments' });
    expect(await countEcritures(db, 'ECR-2026-207')).toBe(1);
  });

  it('REFUSE une écriture introuvable / d\'un autre groupe', async () => {
    await insertEcriture(db, { group_id: 'autre-groupe', status: 'draft' });
    const res = await deleteDraftEcriture(CTX, 'ECR-2026-207', db);
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    expect(await countEcritures(db, 'ECR-2026-207')).toBe(1);
  });

  it('REFUSE un draft hors du scope unité d\'un chef', async () => {
    await insertEcriture(db, { status: 'draft', unite_id: 'u-louveteaux' });
    const res = await deleteDraftEcriture({ groupId: 'val-de-saone', scopeUniteIds: ['u-pionniers'] }, 'ECR-2026-207', db);
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    expect(await countEcritures(db, 'ECR-2026-207')).toBe(1);
  });
});
