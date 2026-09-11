// « Créer l'écriture correspondante » : fin d'exercice, le virement d'un
// remboursement est parti mais sa ligne bancaire ne remontera qu'à l'exercice
// suivant → on crée l'écriture du virement sans attendre la banque.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { createEcritureForRembs } from '../remboursement-ecriture-link';

const SETUP = `
  CREATE TABLE remboursements (
    id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, prenom TEXT, nom TEXT, nature TEXT,
    status TEXT, amount_cents INTEGER, total_cents INTEGER, date_depense TEXT, date_paiement TEXT,
    mode_paiement_id TEXT, unite_id TEXT, ecriture_id TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT, type TEXT, amount_cents INTEGER,
    date_ecriture TEXT, description TEXT, unite_id TEXT, status TEXT,
    ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER, comptaweb_synced INTEGER,
    category_id TEXT, activite_id TEXT, mode_paiement_id TEXT, numero_piece TEXT,
    carte_id TEXT, justif_attendu INTEGER, notes TEXT, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, libelle_origine TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT, comptaweb_id INTEGER);
`;

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP);
  await db.prepare("INSERT INTO modes_paiement VALUES ('MP-CB','CB',3), ('MP-VIR','Virement',1)").run();
  await db.prepare(
    `INSERT INTO remboursements (id, group_id, demandeur, prenom, nom, nature, status, amount_cents,
       total_cents, date_depense, date_paiement, unite_id, created_at)
     VALUES ('RBT-1','g','Florence M.','Florence','Martin','Courses camp','virement_effectue',
       8450, 8450, '2026-07-20', '2026-08-28', 'U-LJ', '2026-07-21')`,
  ).run();
  return db;
}

describe('createEcritureForRembs', () => {
  beforeEach(async () => { testDb = await setup(); });

  it("crée un brouillon de dépense à la date du virement, lié à la demande", async () => {
    const res = await createEcritureForRembs('g', 'RBT-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const e = await testDb.prepare('SELECT * FROM ecritures WHERE id = ?').get<Record<string, unknown>>(res.ecritureId);
    expect(e).toMatchObject({
      type: 'depense',
      status: 'draft',
      amount_cents: 8450,
      date_ecriture: '2026-08-28', // exercice du paiement, pas celui du débit
      description: 'Remboursement Florence Martin – Courses camp',
      unite_id: 'U-LJ',
      mode_paiement_id: 'MP-VIR', // repli virement quand la demande n'a pas de mode
      ligne_bancaire_id: null,
      comptaweb_ecriture_id: null,
      libelle_origine: null, // pas de nudge « titre à renommer »
    });

    const r = await testDb.prepare("SELECT ecriture_id FROM remboursements WHERE id = 'RBT-1'").get<{ ecriture_id: string }>();
    expect(r?.ecriture_id).toBe(res.ecritureId);
  });

  it('garde le mode de paiement renseigné sur la demande', async () => {
    await testDb.prepare("UPDATE remboursements SET mode_paiement_id = 'MP-CB' WHERE id = 'RBT-1'").run();
    const res = await createEcritureForRembs('g', 'RBT-1');
    if (!res.ok) throw new Error(res.error);
    const e = await testDb.prepare('SELECT mode_paiement_id FROM ecritures WHERE id = ?').get<{ mode_paiement_id: string }>(res.ecritureId);
    expect(e?.mode_paiement_id).toBe('MP-CB');
  });

  it('refuse avant le virement', async () => {
    await testDb.prepare("UPDATE remboursements SET status = 'valide_rg' WHERE id = 'RBT-1'").run();
    const res = await createEcritureForRembs('g', 'RBT-1');
    expect(res.ok).toBe(false);
    const n = await testDb.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('refuse une demande déjà liée (pas de 2e écriture)', async () => {
    await testDb.prepare("UPDATE remboursements SET ecriture_id = 'ECR-X' WHERE id = 'RBT-1'").run();
    const res = await createEcritureForRembs('g', 'RBT-1');
    expect(res.ok).toBe(false);
    const n = await testDb.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("refuse une demande d'un autre groupe", async () => {
    const res = await createEcritureForRembs('autre', 'RBT-1');
    expect(res.ok).toBe(false);
  });
});
