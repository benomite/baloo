// Garde-fou anti-perte de donnée (Task 5, nettoyage `EcritureForm` — cf.
// .superpowers/sdd/task-5-brief.md) : depuis que l'imputation (unité /
// catégorie / activité) vit dans `ImputationGrid`, le formulaire d'édition
// ne soumet plus ces trois champs. Ce test prouve, au niveau du VRAI
// service `updateEcriture` sur une BDD en mémoire, qu'un submit du
// formulaire nettoyé (via `buildEcriturePatchFromForm`) NE PERD PAS
// l'imputation existante — seuls les champs réellement soumis (identité)
// sont mis à jour.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { updateEcriture } from '../ecritures';
import { buildEcriturePatchFromForm } from '../../actions/ecriture-form-patch';

// `updateEcriture` (service) utilise le singleton `getDb()` en interne (pas
// de param `db` injectable, contrairement à `deleteDraftEcriture`) — on
// mocke le module pour pointer vers la BDD en mémoire du test, comme
// `ecritures-ventilate.test.ts`.
let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    category_id TEXT,
    mode_paiement_id TEXT,
    activite_id TEXT,
    numero_piece TEXT,
    carte_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    libelle_origine TEXT,
    ventilation_group_id TEXT,
    comptaweb_ecriture_id INTEGER,
    created_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-07-13T00:00:00Z'
  );
  -- Tables jointes par getEcriture (appelé en fin de updateEcriture) :
  -- doivent exister même vides, sinon "no such table".
  CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT, name TEXT, couleur TEXT);
  CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE activites (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, porteur TEXT, type TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
`;

async function setupDb(): Promise<{ client: Client; db: DbWrapper }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  await db.exec(`
    INSERT INTO unites (id, code, name) VALUES ('u1', 'FAR', 'Farfadets');
    INSERT INTO categories (id, name) VALUES ('c1', 'Intendance');
    INSERT INTO activites (id, name) VALUES ('a1', 'Camps');
    INSERT INTO modes_paiement (id, name) VALUES ('m1', 'CB');
  `);
  await db.prepare(
    `INSERT INTO ecritures
       (id, group_id, unite_id, category_id, activite_id, mode_paiement_id,
        date_ecriture, description, amount_cents, type, status, notes)
     VALUES
       ('E1', 'g1', 'u1', 'c1', 'a1', 'm1',
        '2026-07-01', 'Ancien libellé', 1000, 'depense', 'draft', 'ancienne note')`,
  ).run();
  return { client, db };
}

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe('updateEcriture — submit du formulaire nettoyé (Task 5) préserve l’imputation', () => {
  beforeEach(async () => {
    ({ db: testDb } = await setupDb());
  });

  it("un submit SANS unite_id/category_id/activite_id dans le FormData ne les écrase PAS", async () => {
    // Reproduit exactement ce que soumet désormais `EcritureForm` (mode
    // 'edit') après Task 5 : plus de champs d'imputation dans le DOM.
    const formData = makeFormData({
      date_ecriture: '2026-07-14',
      description: 'Nouveau libellé',
      montant: '55,00',
      type: 'depense',
      mode_paiement_id: 'm1',
      numero_piece: 'P42',
      notes: 'nouvelle note',
    });

    const patch = buildEcriturePatchFromForm(formData);
    const updated = await updateEcriture({ groupId: 'g1' }, 'E1', patch);

    expect(updated).not.toBeNull();
    // Imputation préservée — c'était la valeur d'origine, jamais soumise.
    expect(updated!.unite_id).toBe('u1');
    expect(updated!.category_id).toBe('c1');
    expect(updated!.activite_id).toBe('a1');
    // Champs réellement soumis : bien mis à jour.
    expect(updated!.description).toBe('Nouveau libellé');
    expect(updated!.amount_cents).toBe(5500);
    expect(updated!.date_ecriture).toBe('2026-07-14');
    expect(updated!.numero_piece).toBe('P42');
    expect(updated!.notes).toBe('nouvelle note');
  });
});
