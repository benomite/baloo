// Reproduction du cas prod 2026-08-03 de bout en bout.
//
// Situation : « Avance territoire camp Orange » (103,40 €) créée à la main
// faisait doublon avec les DEUX écritures du territoire (ficelle 49,50 + pain
// 53,90). Supprimée dans Comptaweb → la sync la tague `supprimee_cw`. Mais son
// dépôt de justif y pendait encore, et les 2 fichiers avaient déjà été partagés
// vers les écritures du territoire : le nettoyage local était donc SANS PERTE,
// et pourtant refusé — sans aucun chemin pour détacher le dépôt.
//
// Ce test prouve la séquence de sortie : refus → détacher → suppression OK,
// et que les justifs partagés survivent à l'opération.

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
  nextIdOn: async (p: string) => `${p}-X`,
  currentTimestamp: () => '2026-08-03T10:00:00Z',
}));

import { detachDepotFromEcriture } from '../depots';
import { deleteArbitratedEcriture, listAttachments, describeBlockers } from '../ecritures-arbitrage';

const COQUILLE = 'ECR-504';
const FICELLE = 'ECR-511';
const PAIN = 'ECR-512';
const DEPOT = 'DEP-054';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, status TEXT NOT NULL, comptaweb_ecriture_id INTEGER,
      comptaweb_synced INTEGER DEFAULT 0, updated_at TEXT
    );
    CREATE TABLE depots_justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, submitted_by_user_id TEXT, titre TEXT,
      statut TEXT NOT NULL, ecriture_id TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, file_path TEXT, original_filename TEXT,
      mime_type TEXT, entity_type TEXT, entity_id TEXT, uploaded_at TEXT,
    obsolete_at TEXT
    );
    CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT, date_depot TEXT);
    CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT, demandeur TEXT);
    CREATE TABLE avances_camp (id TEXT PRIMARY KEY, ecriture_id TEXT, beneficiaire TEXT);
    CREATE TABLE inbox_suggestion_rejets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT, ecriture_id TEXT,
      target_kind TEXT, target_id TEXT
    );
  `);

  // La coquille supprimée dans CW + les 2 écritures du territoire, vivantes.
  for (const [id, desc, cents, status, cwId] of [
    [COQUILLE, 'Avance territoire camp Orange', 10340, 'supprimee_cw', 2468759],
    [FICELLE, 'remboursement de la ficelle', 4950, 'mirror', 2468766],
    [PAIN, 'remboursement du pain', 5390, 'mirror', 2468765],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, comptaweb_ecriture_id)
         VALUES (?, 'g', '2026-07-29', ?, ?, 'depense', ?, ?)`,
      )
      .run(id, desc, cents, status, cwId);
  }

  await db
    .prepare(
      `INSERT INTO depots_justificatifs (id, group_id, submitted_by_user_id, titre, statut, ecriture_id, created_at, updated_at)
       VALUES (?, 'g', 'u1', 'Avance territoire camp Orange', 'rattache', ?, '2026-07-29T12:53:18Z', '2026-07-29T12:53:18Z')`,
    )
    .run(DEPOT, COQUILLE);

  // Les 2 fichiers d'origine, re-pointés sur la coquille par le rattachement…
  const fichiers = [
    ['JUS-174', 'valdo ficelle.jpg'],
    ['JUS-175', 'valdo pain.jpg'],
  ] as const;
  for (const [id, name] of fichiers) {
    await db
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
         VALUES (?, 'g', ?, ?, 'image/jpeg', 'ecriture', ?, '2026-07-29T12:53:18Z')`,
      )
      .run(id, `depot/${DEPOT}/${id}-${name}`, name, COQUILLE);
  }
  // … et leurs copies PARTAGÉES vers les 2 écritures du territoire.
  let n = 194;
  for (const cible of [FICELLE, PAIN]) {
    for (const [srcId, name] of fichiers) {
      await db
        .prepare(
          `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
           VALUES (?, 'g', ?, ?, 'image/jpeg', 'ecriture', ?, '2026-07-30T00:00:00Z')`,
        )
        .run(`JUS-${n++}`, `depot/${DEPOT}/${srcId}-${name}`, name, cible);
    }
  }
  return db;
}

describe('cas prod 2026-08-03 : nettoyer une coquille dont le dépôt pendait encore', () => {
  beforeEach(async () => {
    testDb = await setup();
  });

  it('avant : la suppression est refusée, et la bannière sait dire par quoi', async () => {
    const res = await deleteArbitratedEcriture('g', COQUILLE, testDb);
    expect(res).toEqual({ ok: false, reason: 'has_attachments' });

    const blockers = describeBlockers(await listAttachments(testDb, COQUILLE));
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'depot', id: DEPOT, detachable: true, file_count: 2 });
    expect(blockers[0].label).toContain('Avance territoire camp Orange');

    // L'écriture est toujours là : aucun contournement du garde-fou.
    const still = await testDb.prepare('SELECT id FROM ecritures WHERE id = ?').get<{ id: string }>(COQUILLE);
    expect(still?.id).toBe(COQUILLE);
  });

  it('après détachement : la suppression passe et les justifs partagés survivent', async () => {
    await detachDepotFromEcriture({ groupId: 'g' }, DEPOT);

    expect(describeBlockers(await listAttachments(testDb, COQUILLE))).toEqual([]);

    const res = await deleteArbitratedEcriture('g', COQUILLE, testDb);
    expect(res).toEqual({ ok: true });
    const gone = await testDb.prepare('SELECT id FROM ecritures WHERE id = ?').get<{ id: string }>(COQUILLE);
    expect(gone).toBeUndefined();

    // Les 2 écritures du territoire gardent leurs 2 justifs chacune.
    for (const cible of [FICELLE, PAIN]) {
      const r = await testDb
        .prepare(
          `SELECT COUNT(*) AS n FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = ?`,
        )
        .get<{ n: number }>(cible);
      expect(r?.n).toBe(2);
    }

    // Le dépôt est revenu dans la file « à traiter », ses fichiers avec lui :
    // rien n'est perdu, le trésorier peut le re-rattacher où il veut.
    const depot = await testDb
      .prepare('SELECT statut, ecriture_id FROM depots_justificatifs WHERE id = ?')
      .get<{ statut: string; ecriture_id: string | null }>(DEPOT);
    expect(depot).toMatchObject({ statut: 'a_traiter', ecriture_id: null });
    const rapatries = await testDb
      .prepare(`SELECT COUNT(*) AS n FROM justificatifs WHERE entity_type = 'depot' AND entity_id = ?`)
      .get<{ n: number }>(DEPOT);
    expect(rapatries?.n).toBe(2);
  });

  it('aucun blob n’est perdu : les 6 lignes justificatifs sont toujours là', async () => {
    await detachDepotFromEcriture({ groupId: 'g' }, DEPOT);
    await deleteArbitratedEcriture('g', COQUILLE, testDb);

    const total = await testDb.prepare('SELECT COUNT(*) AS n FROM justificatifs').get<{ n: number }>();
    expect(total?.n).toBe(6);
  });
});
