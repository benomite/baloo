import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';
import { bornesPourExercice } from '../bornes';
import {
  controleEcrituresSansJustif,
  controleRembsSansPdf,
  controleDepotsOrphelins,
  controleEcartsMiroir,
} from '../controles';

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

describe('controleDepotsOrphelins', () => {
  beforeEach(async () => {
    await db.exec(`
      CREATE TABLE depots_justificatifs (
        id TEXT PRIMARY KEY, group_id TEXT, titre TEXT, amount_cents INTEGER,
        date_estimee TEXT, statut TEXT, ecriture_id TEXT, remboursement_id TEXT,
        created_at TEXT
      );
    `);
  });

  async function insertDepot(o: {
    id: string;
    statut?: string;
    ecriture?: string | null;
    remb?: string | null;
    date?: string;
  }) {
    await db
      .prepare(
        `INSERT INTO depots_justificatifs
           (id, group_id, titre, amount_cents, date_estimee, statut, ecriture_id, remboursement_id, created_at)
         VALUES (?, 'g', 'Ticket Vival', 1059, ?, ?, ?, ?, '2026-08-06T10:00:00Z')`,
      )
      .run(o.id, o.date ?? '2026-08-06', o.statut ?? 'a_traiter', o.ecriture ?? null, o.remb ?? null);
  }

  it('signale un dépôt rattaché à rien', async () => {
    await insertDepot({ id: 'DEP-1' });
    const r = await controleDepotsOrphelins(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['DEP-1']);
  });

  it('ne signale pas un dépôt rattaché à une écriture ou à un remboursement', async () => {
    await insertDepot({ id: 'DEP-E', ecriture: 'ECR-1' });
    await insertDepot({ id: 'DEP-R', remb: 'REMB-1' });
    const r = await controleDepotsOrphelins(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });

  it('ne signale pas un dépôt rejeté', async () => {
    await insertDepot({ id: 'DEP-X', statut: 'rejete' });
    const r = await controleDepotsOrphelins(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });
});

describe('controleEcartsMiroir', () => {
  async function insertAvecStatut(id: string, status: string) {
    await db
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, justif_attendu, status)
         VALUES (?, 'g', '2026-08-05', 'Essence', 6500, 'depense', 0, ?)`,
      )
      .run(id, status);
  }

  it('sépare les écarts de miroir des vraies divergences', async () => {
    await insertAvecStatut('ECR-D', 'draft');
    await insertAvecStatut('ECR-P', 'pending_sync');
    await insertAvecStatut('ECR-V', 'divergent');
    await insertAvecStatut('ECR-M', 'mirror');
    const [ecarts, divergentes] = await controleEcartsMiroir(db, 'g', BORNES);
    expect(ecarts.cle).toBe('ecart_miroir');
    expect(ecarts.lignes.map((l) => l.id).sort()).toEqual(['ECR-D', 'ECR-P', 'ECR-V']);
    expect(divergentes.cle).toBe('ecriture_divergente');
    expect(divergentes.lignes.map((l) => l.id)).toEqual(['ECR-V']);
  });

  it('ne compte pas les états terminaux normaux du miroir', async () => {
    await insertAvecStatut('ECR-S', 'supprimee_cw');
    await insertAvecStatut('ECR-A', 'agrege_remplace');
    const [ecarts] = await controleEcartsMiroir(db, 'g', BORNES);
    expect(ecarts.lignes).toEqual([]);
  });

  it('porte le statut dans le détail de chaque ligne', async () => {
    await insertAvecStatut('ECR-D', 'draft');
    const [ecarts] = await controleEcartsMiroir(db, 'g', BORNES);
    expect(ecarts.lignes[0].detail).toBe('statut draft');
  });
});
