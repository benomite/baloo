// Non-régression de la bascule des blockers de /cloture sur les contrôles
// partagés de l'export (Task 5). Le point vérifié : un justif OBSOLÈTE ne
// compte plus comme une pièce présente.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../context', () => ({
  getCurrentContext: async () => ({ groupId: 'g', userId: 'u', role: 'tresorier' }),
}));
vi.mock('../../services/depots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/depots')>();
  return { ...actual, ensureDepotsSchema: async () => {} };
});

import { getClotureReport } from '../cloture';

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(client);
  await testDb.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, justif_attendu INTEGER DEFAULT 0, status TEXT
    );
    CREATE TABLE justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, file_path TEXT, original_filename TEXT,
      entity_type TEXT, entity_id TEXT, obsolete_at TEXT
    );
    CREATE TABLE depots_justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, titre TEXT, amount_cents INTEGER,
      date_estimee TEXT, statut TEXT, ecriture_id TEXT, remboursement_id TEXT,
      created_at TEXT
    );
    CREATE TABLE remboursements (
      id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, total_cents INTEGER,
      date_depense TEXT, created_at TEXT, status TEXT
    );
    CREATE TABLE abandons_frais (
      id TEXT PRIMARY KEY, group_id TEXT, date_depense TEXT, status TEXT
    );
  `);
});

function countOf(report: Awaited<ReturnType<typeof getClotureReport>>, kind: string) {
  return report.blockers.find((b) => b.kind === kind)!.count;
}

describe('getClotureReport', () => {
  it('compte une écriture dont le seul justif est obsolète comme non justifiée', async () => {
    await testDb
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, justif_attendu, status)
         VALUES ('ECR-1', 'g', '2026-08-05', 'Intermarché', 8777, 'depense', 1, 'mirror')`,
      )
      .run();
    await testDb
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id, obsolete_at)
         VALUES ('JUS-1', 'g', 'blob/x.jpg', 'x.jpg', 'ecriture', 'ECR-1', '2026-08-10T00:00:00Z')`,
      )
      .run();
    const report = await getClotureReport(2026, 8);
    expect(countOf(report, 'ecriture_sans_justif')).toBe(1);
  });

  it('borne le comptage au mois demandé', async () => {
    await testDb
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, justif_attendu, status)
         VALUES ('ECR-JUIL', 'g', '2026-07-31', 'Essence', 6500, 'depense', 1, 'mirror')`,
      )
      .run();
    const report = await getClotureReport(2026, 8);
    expect(countOf(report, 'ecriture_sans_justif')).toBe(0);
  });

  it('compte les dépôts rattachés à rien du mois', async () => {
    await testDb
      .prepare(
        `INSERT INTO depots_justificatifs
           (id, group_id, titre, amount_cents, date_estimee, statut, ecriture_id, remboursement_id, created_at)
         VALUES ('DEP-1', 'g', 'Vival', 1059, '2026-08-06', 'a_traiter', NULL, NULL, '2026-08-06T10:00:00Z')`,
      )
      .run();
    const report = await getClotureReport(2026, 8);
    expect(countOf(report, 'justif_orphelin')).toBe(1);
  });

  it('compte aussi un dépôt orphelin d’un mois antérieur (I4 : le comptage est cumulatif)', async () => {
    await testDb
      .prepare(
        `INSERT INTO depots_justificatifs
           (id, group_id, titre, amount_cents, date_estimee, statut, ecriture_id, remboursement_id, created_at)
         VALUES ('DEP-MARS', 'g', 'Leclerc', 2340, '2026-03-12', 'a_traiter', NULL, NULL, '2026-03-12T10:00:00Z')`,
      )
      .run();
    const report = await getClotureReport(2026, 8);
    expect(countOf(report, 'justif_orphelin')).toBe(1);
  });
});
