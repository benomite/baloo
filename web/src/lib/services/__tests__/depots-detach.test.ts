// Cas terrain 2026-08-03 : une écriture créée à la main faisait doublon avec
// celles du territoire côté Comptaweb. Benoît l'a supprimée dans CW, la sync
// l'a taguée `supprimee_cw` — mais la suppression du reste local restait
// refusée « une pièce est attachée » : son dépôt de justif (statut `rattache`)
// pointait encore dessus, et RIEN ne permettait de le détacher. Un
// rattachement était définitif, même faux.
//
// `detachDepotFromEcriture` remet le dépôt dans la file « à traiter » et
// rapatrie ses justifs vers le dépôt. Non destructif : aucun blob touché,
// aucune ligne supprimée, les partages vers d'autres écritures survivent.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-X`,
  currentTimestamp: () => '2026-08-03T10:00:00Z',
}));

import { detachDepotFromEcriture } from '../depots';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE depots_justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, submitted_by_user_id TEXT, titre TEXT NOT NULL,
      description TEXT, category_id TEXT, unite_id TEXT, amount_cents INTEGER,
      date_estimee TEXT, carte_id TEXT, activite_id TEXT, statut TEXT NOT NULL DEFAULT 'a_traiter',
      ecriture_id TEXT, remboursement_id TEXT, motif_rejet TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, file_path TEXT, original_filename TEXT,
      mime_type TEXT, entity_type TEXT, entity_id TEXT, uploaded_at TEXT
    );
  `);
  return db;
}

/**
 * État de départ = celui de la prod : dépôt DEP-1 rattaché à ECR-A, ses 2
 * fichiers re-pointés vers ECR-A par le rattachement.
 */
async function insertDepotRattache(
  db: DbWrapper,
  o: { statut?: string; ecriture_id?: string | null; group_id?: string } = {},
) {
  await db
    .prepare(
      `INSERT INTO depots_justificatifs
         (id, group_id, submitted_by_user_id, titre, statut, ecriture_id, created_at, updated_at)
       VALUES ('DEP-1', ?, 'u1', 'Avance territoire', ?, ?, '2026-07-29T00:00:00Z', '2026-07-29T00:00:00Z')`,
    )
    .run(o.group_id ?? 'g', o.statut ?? 'rattache', o.ecriture_id === undefined ? 'ECR-A' : o.ecriture_id);
  for (const [id, file] of [
    ['JUS-1', 'ficelle.jpg'],
    ['JUS-2', 'pain.jpg'],
  ]) {
    await db
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
         VALUES (?, 'g', ?, ?, 'image/jpeg', 'ecriture', 'ECR-A', '2026-07-29T00:00:00Z')`,
      )
      .run(id, `depot/DEP-1/${id}-${file}`, file);
  }
}

async function readDepot(db: DbWrapper) {
  return (await db
    .prepare('SELECT * FROM depots_justificatifs WHERE id = ?')
    .get<{ statut: string; ecriture_id: string | null; updated_at: string | null }>('DEP-1'))!;
}

async function readJustifs(db: DbWrapper) {
  return db
    .prepare('SELECT id, entity_type, entity_id, file_path FROM justificatifs ORDER BY id')
    .all<{ id: string; entity_type: string; entity_id: string; file_path: string }>();
}

describe('detachDepotFromEcriture — défaire un rattachement erroné', () => {
  beforeEach(async () => {
    testDb = await setup();
  });

  it('remet le dépôt à traiter et rapatrie ses justifs vers le dépôt', async () => {
    await insertDepotRattache(testDb);

    const res = await detachDepotFromEcriture({ groupId: 'g' }, 'DEP-1');

    expect(res.previous_ecriture_id).toBe('ECR-A');
    const d = await readDepot(testDb);
    expect(d.statut).toBe('a_traiter');
    expect(d.ecriture_id).toBeNull();
    expect(d.updated_at).toBe('2026-08-03T10:00:00Z');

    const justifs = await readJustifs(testDb);
    expect(justifs).toHaveLength(2);
    for (const j of justifs) {
      expect(j.entity_type).toBe('depot');
      expect(j.entity_id).toBe('DEP-1');
    }
  });

  it("libère l'écriture : plus aucune pièce ne pointe vers elle", async () => {
    await insertDepotRattache(testDb);

    await detachDepotFromEcriture({ groupId: 'g' }, 'DEP-1');

    const restant = await testDb
      .prepare(
        `SELECT COUNT(*) AS n FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = 'ECR-A'`,
      )
      .get<{ n: number }>();
    expect(restant?.n).toBe(0);
    const depots = await testDb
      .prepare(`SELECT COUNT(*) AS n FROM depots_justificatifs WHERE ecriture_id = 'ECR-A'`)
      .get<{ n: number }>();
    expect(depots?.n).toBe(0);
  });

  it('préserve les justifs PARTAGÉS vers une autre écriture (1 justif = 2 écritures)', async () => {
    await insertDepotRattache(testDb);
    // Partage déjà fait vers ECR-B : mêmes blobs, lignes distinctes.
    await testDb
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
         VALUES ('JUS-9', 'g', 'depot/DEP-1/JUS-1-ficelle.jpg', 'ficelle.jpg', 'image/jpeg', 'ecriture', 'ECR-B', '2026-07-30T00:00:00Z')`,
      )
      .run();

    await detachDepotFromEcriture({ groupId: 'g' }, 'DEP-1');

    const partage = (await readJustifs(testDb)).find((j) => j.id === 'JUS-9');
    expect(partage?.entity_type).toBe('ecriture');
    expect(partage?.entity_id).toBe('ECR-B');
  });

  it("ne touche pas un justif uploadé directement sur l'écriture (hors dépôt)", async () => {
    await insertDepotRattache(testDb);
    await testDb
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
         VALUES ('JUS-8', 'g', 'ecriture/ECR-A/JUS-8-facture.pdf', 'facture.pdf', 'application/pdf', 'ecriture', 'ECR-A', '2026-07-29T00:00:00Z')`,
      )
      .run();

    await detachDepotFromEcriture({ groupId: 'g' }, 'DEP-1');

    const direct = (await readJustifs(testDb)).find((j) => j.id === 'JUS-8');
    expect(direct?.entity_type).toBe('ecriture');
    expect(direct?.entity_id).toBe('ECR-A');
  });

  it("ne touche pas les justifs d'un AUTRE dépôt rattaché à la même écriture", async () => {
    await insertDepotRattache(testDb);
    await testDb
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
         VALUES ('JUS-7', 'g', 'depot/DEP-2/JUS-7-autre.jpg', 'autre.jpg', 'image/jpeg', 'ecriture', 'ECR-A', '2026-07-29T00:00:00Z')`,
      )
      .run();

    await detachDepotFromEcriture({ groupId: 'g' }, 'DEP-1');

    const autre = (await readJustifs(testDb)).find((j) => j.id === 'JUS-7');
    expect(autre?.entity_type).toBe('ecriture');
    expect(autre?.entity_id).toBe('ECR-A');
  });

  it('refuse un dépôt déjà à traiter (rien à détacher) sans rien modifier', async () => {
    await insertDepotRattache(testDb, { statut: 'a_traiter', ecriture_id: null });

    await expect(detachDepotFromEcriture({ groupId: 'g' }, 'DEP-1')).rejects.toThrow(/rattaché/);

    const d = await readDepot(testDb);
    expect(d.statut).toBe('a_traiter');
  });

  it('refuse un dépôt rejeté', async () => {
    await insertDepotRattache(testDb, { statut: 'rejete', ecriture_id: null });

    await expect(detachDepotFromEcriture({ groupId: 'g' }, 'DEP-1')).rejects.toThrow(/rattaché/);
  });

  it('lève une erreur si le dépôt est introuvable', async () => {
    await expect(detachDepotFromEcriture({ groupId: 'g' }, 'DEP-INEXISTANT')).rejects.toThrow(/introuvable/);
  });

  it("refuse le dépôt d'un autre groupe", async () => {
    await insertDepotRattache(testDb);

    await expect(detachDepotFromEcriture({ groupId: 'autre' }, 'DEP-1')).rejects.toThrow(/introuvable/);

    const d = await readDepot(testDb);
    expect(d.statut).toBe('rattache');
    expect(d.ecriture_id).toBe('ECR-A');
  });

  it('est idempotent en pratique : un second appel échoue proprement', async () => {
    await insertDepotRattache(testDb);

    await detachDepotFromEcriture({ groupId: 'g' }, 'DEP-1');
    await expect(detachDepotFromEcriture({ groupId: 'g' }, 'DEP-1')).rejects.toThrow(/rattaché/);
  });
});
