import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';
import { bornesPourExercice } from '../bornes';
import { controleEcrituresSansJustif, controleRembsSansPdf } from '../controles';

const BORNES = bornesPourExercice('2025-2026');
let db: DbWrapper;

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const d = wrapClient(client);
  await d.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, justif_attendu INTEGER DEFAULT 0, status TEXT
    );
    CREATE TABLE justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, file_path TEXT, original_filename TEXT,
      entity_type TEXT, entity_id TEXT, obsolete_at TEXT
    );
    CREATE TABLE remboursements (
      id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, total_cents INTEGER,
      date_depense TEXT, created_at TEXT, status TEXT
    );
  `);
  return d;
}

async function insertEcriture(
  o: { id: string; date?: string; justif?: number; type?: string },
) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, justif_attendu, status)
       VALUES (?, 'g', ?, 'Intermarché', 8777, ?, ?, 'mirror')`,
    )
    .run(o.id, o.date ?? '2026-08-05', o.type ?? 'depense', o.justif ?? 1);
}

async function insertJustif(o: { id: string; entity: string; obsolete?: string | null }) {
  await db
    .prepare(
      `INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id, obsolete_at)
       VALUES (?, 'g', 'blob/x.jpg', 'x.jpg', 'ecriture', ?, ?)`,
    )
    .run(o.id, o.entity, o.obsolete ?? null);
}

beforeEach(async () => {
  db = await setup();
});

describe('controleEcrituresSansJustif', () => {
  it("signale une dépense attendant un justif qui n'en a aucun", async () => {
    await insertEcriture({ id: 'ECR-1' });
    const r = await controleEcrituresSansJustif(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['ECR-1']);
  });

  it("ne signale pas une dépense qui a un justif vivant", async () => {
    await insertEcriture({ id: 'ECR-1' });
    await insertJustif({ id: 'JUS-1', entity: 'ECR-1' });
    const r = await controleEcrituresSansJustif(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });

  it('signale une dépense dont le seul justif est obsolete', async () => {
    // Écart corrigé vs queries/cloture.ts, qui ne filtre pas obsolete_at :
    // un justif remplacé y compte encore comme une pièce présente.
    await insertEcriture({ id: 'ECR-1' });
    await insertJustif({ id: 'JUS-1', entity: 'ECR-1', obsolete: '2026-08-10T00:00:00Z' });
    const r = await controleEcrituresSansJustif(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['ECR-1']);
  });

  it('ignore les recettes et les écritures hors exercice', async () => {
    await insertEcriture({ id: 'ECR-RECETTE', type: 'recette' });
    await insertEcriture({ id: 'ECR-HORS', date: '2026-09-01' });
    await insertEcriture({ id: 'ECR-LIMITE', date: '2026-08-31' });
    const r = await controleEcrituresSansJustif(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['ECR-LIMITE']);
  });

  it('ignore un autre groupe', async () => {
    await insertEcriture({ id: 'ECR-1' });
    const r = await controleEcrituresSansJustif(db, 'autre', BORNES);
    expect(r.lignes).toEqual([]);
  });
});

describe('controleRembsSansPdf', () => {
  async function insertRemb(o: { id: string; status: string; date?: string }) {
    await db
      .prepare(
        `INSERT INTO remboursements (id, group_id, demandeur, total_cents, date_depense, created_at, status)
         VALUES (?, 'g', 'Pierre', 4200, ?, '2026-07-01T00:00:00Z', ?)`,
      )
      .run(o.id, o.date ?? '2026-07-01', o.status);
  }

  it('signale un remboursement abouti sans feuille PDF', async () => {
    await insertRemb({ id: 'REMB-1', status: 'termine' });
    await insertRemb({ id: 'REMB-2', status: 'virement_effectue' });
    const r = await controleRembsSansPdf(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id).sort()).toEqual(['REMB-1', 'REMB-2']);
  });

  it('ne signale pas un remboursement qui a sa feuille', async () => {
    await insertRemb({ id: 'REMB-1', status: 'termine' });
    await db
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id, obsolete_at)
         VALUES ('JUS-F', 'g', 'blob/f.pdf', 'feuille.pdf', 'remboursement_feuille', 'REMB-1', NULL)`,
      )
      .run();
    const r = await controleRembsSansPdf(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });

  it('ne signale pas une demande encore en cours ou refusée', async () => {
    await insertRemb({ id: 'REMB-A', status: 'a_traiter' });
    await insertRemb({ id: 'REMB-R', status: 'refuse' });
    const r = await controleRembsSansPdf(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });

  it('borne sur created_at quand date_depense est absente', async () => {
    await db
      .prepare(
        `INSERT INTO remboursements (id, group_id, demandeur, total_cents, date_depense, created_at, status)
         VALUES ('REMB-N', 'g', 'Pierre', 4200, NULL, '2026-08-31T18:00:00Z', 'termine')`,
      )
      .run();
    const r = await controleRembsSansPdf(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['REMB-N']);
  });
});
