// Conversion d'une demande de remboursement passée PAR ERREUR (le déposeur
// voulait juste déposer un justif d'une dépense déjà payée par le groupe).
// On préserve le justif, on le rend disponible côté écriture/dépôt, on
// neutralise le remboursement SANS email de refus (statut 'converti').

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
let seq = 0;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-NEW-${++seq}`,
  currentTimestamp: () => '2026-07-07T10:00:00Z',
}));

import { convertRemboursementToDepot } from '../remboursement-convert';

const SETUP = `
  CREATE TABLE remboursements (
    id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, nature TEXT,
    amount_cents INTEGER, total_cents INTEGER, date_depense TEXT, unite_id TEXT,
    status TEXT NOT NULL, ecriture_id TEXT, motif_refus TEXT, updated_at TEXT
  );
  CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, status TEXT);
  CREATE TABLE justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL, mime_type TEXT, entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL, uploaded_at TEXT
  );
  CREATE TABLE depots_justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT, submitted_by_user_id TEXT, titre TEXT NOT NULL,
    description TEXT, category_id TEXT, unite_id TEXT, amount_cents INTEGER,
    date_estimee TEXT, carte_id TEXT, activite_id TEXT, statut TEXT NOT NULL DEFAULT 'a_traiter',
    ecriture_id TEXT, motif_rejet TEXT, created_at TEXT, updated_at TEXT
  );
`;

async function setup(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP);
  return db;
}

async function insertRemb(db: DbWrapper, o: { id: string; ecritureId?: string | null; status?: string; nature?: string; total?: number; unite?: string | null }) {
  await db
    .prepare(
      `INSERT INTO remboursements (id, group_id, demandeur, nature, amount_cents, total_cents, date_depense, unite_id, status, ecriture_id)
       VALUES (?, 'g', 'Parent X', ?, ?, ?, '2026-06-27', ?, ?, ?)`,
    )
    .run(o.id, o.nature ?? 'Bâches', o.total ?? 2997, o.total ?? 2997, o.unite ?? null, o.status ?? 'a_traiter', o.ecritureId ?? null);
}

async function insertRembJustif(db: DbWrapper, rembId: string, filename: string) {
  await db
    .prepare(
      `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
       VALUES (?, 'g', ?, ?, 'image/jpeg', 'remboursement', ?, '2026-07-05T00:00:00Z')`,
    )
    .run(`JUS-seed-${rembId}`, `remboursement/${rembId}/${filename}`, filename, rembId);
}

async function justifsOn(db: DbWrapper, entityType: string, entityId: string) {
  return db
    .prepare('SELECT file_path FROM justificatifs WHERE entity_type=? AND entity_id=? ORDER BY file_path')
    .all<{ file_path: string }>(entityType, entityId);
}

describe('convertRemboursementToDepot', () => {
  beforeEach(async () => {
    seq = 0;
    testDb = await setup();
  });

  it('remb lié à une écriture → justif attaché à l\'écriture, délié, statut converti, pas de perte', async () => {
    await insertRemb(testDb, { id: 'RBT-1', ecritureId: 'ECR-A', status: 'a_traiter' });
    await testDb.prepare("INSERT INTO ecritures (id, group_id, status) VALUES ('ECR-A','g','draft')").run();
    await insertRembJustif(testDb, 'RBT-1', 'ticket.jpg');

    const res = await convertRemboursementToDepot({ groupId: 'g' }, 'RBT-1');

    expect(res.status).toBe('converti');
    expect(res.targetEcritureId).toBe('ECR-A');
    expect(res.createdDepotId).toBeNull();
    expect(res.copied).toBe(1);
    // Justif désormais direct sur l'écriture (même blob).
    const onEcr = await justifsOn(testDb, 'ecriture', 'ECR-A');
    expect(onEcr.map((j) => j.file_path)).toEqual(['remboursement/RBT-1/ticket.jpg']);
    // Original préservé sur le remboursement.
    expect(await justifsOn(testDb, 'remboursement', 'RBT-1')).toHaveLength(1);
    // Remboursement délié + converti.
    const r = await testDb.prepare('SELECT ecriture_id, status FROM remboursements WHERE id=?').get<{ ecriture_id: string | null; status: string }>('RBT-1');
    expect(r).toEqual({ ecriture_id: null, status: 'converti' });
  });

  it('remb NON lié → crée un dépôt a_traiter avec le justif', async () => {
    await insertRemb(testDb, { id: 'RBT-2', ecritureId: null, nature: 'Courses', total: 1000, unite: 'u-fa' });
    await insertRembJustif(testDb, 'RBT-2', 'facture.pdf');

    const res = await convertRemboursementToDepot({ groupId: 'g' }, 'RBT-2');

    expect(res.status).toBe('converti');
    expect(res.targetEcritureId).toBeNull();
    expect(res.createdDepotId).toBeTruthy();
    expect(res.copied).toBe(1);
    // Dépôt créé, a_traiter, avec le justif copié.
    const dep = await testDb.prepare('SELECT titre, amount_cents, statut, unite_id FROM depots_justificatifs WHERE id=?').get<Record<string, unknown>>(res.createdDepotId!);
    expect(dep).toMatchObject({ titre: 'Courses', amount_cents: 1000, statut: 'a_traiter', unite_id: 'u-fa' });
    expect(await justifsOn(testDb, 'depot', res.createdDepotId!)).toHaveLength(1);
    const r = await testDb.prepare('SELECT status FROM remboursements WHERE id=?').get<{ status: string }>('RBT-2');
    expect(r?.status).toBe('converti');
  });

  it('déjà converti → erreur (pas de double conversion)', async () => {
    await insertRemb(testDb, { id: 'RBT-3', status: 'converti' });
    await expect(convertRemboursementToDepot({ groupId: 'g' }, 'RBT-3')).rejects.toThrow(/déjà converti/i);
  });

  it('remboursement introuvable → erreur', async () => {
    await expect(convertRemboursementToDepot({ groupId: 'g' }, 'RBT-ABSENT')).rejects.toThrow(/introuvable/i);
  });
});
