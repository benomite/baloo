// Tests de la migration du statut enum `ecritures` (Task 5 de la phase 1
// du pivot "miroir strict + MCP-first").
//
// La table avait historiquement :
//   status TEXT NOT NULL DEFAULT 'brouillon'
//     CHECK(status IN ('brouillon', 'valide', 'saisie_comptaweb'))
//
// On la fait migrer vers :
//   status TEXT NOT NULL DEFAULT 'draft'  (PAS de CHECK)
// avec le mapping :
//   brouillon         → draft
//   valide            → pending_sync
//   saisie_comptaweb  → mirror
// (les nouveaux statuts `pending_cw` et `divergent` sont insérables après
// migration mais ne sont pas présents dans les BDDs historiques.)
//
// La validation des valeurs reste côté code (cf. AGENTS.md "CHECK SQL en
// général : à éviter pour les workflows" + ADR-019).

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient } from '../db';
import { migrateEcrituresStatus } from './business-schema';

// SQL d'origine de la table `ecritures`, copié depuis l'ancienne version
// de business-schema.ts (avant Task 5). Inclut le CHECK SQL et toutes
// les colonnes que la table peut avoir en prod aujourd'hui.
const LEGACY_ECRITURES_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('depense', 'recette')),
    category_id TEXT,
    mode_paiement_id TEXT,
    activite_id TEXT,
    carte_id TEXT,
    numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'brouillon' CHECK(status IN ('brouillon', 'valide', 'saisie_comptaweb')),
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    comptaweb_ecriture_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE INDEX idx_ecritures_group ON ecritures(group_id);
  CREATE INDEX idx_ecritures_unite ON ecritures(unite_id);
  CREATE INDEX idx_ecritures_date ON ecritures(date_ecriture);
  CREATE INDEX idx_ecritures_type ON ecritures(type);
  CREATE INDEX idx_ecritures_status ON ecritures(status);
  CREATE INDEX idx_ecritures_ligne_bancaire ON ecritures(ligne_bancaire_id, ligne_bancaire_sous_index);
  CREATE INDEX idx_ecritures_carte ON ecritures(carte_id);
`;

async function setupLegacyDb(): Promise<{ client: Client; db: ReturnType<typeof wrapClient> }> {
  const client = createClient({ url: 'file::memory:' });
  // Désactive le check FK : la table `ecritures` (nouvelle ou ancienne)
  // référence cartes/unites/categories/etc. qui ne sont pas créées dans
  // ce test isolé. La migration le fait déjà localement, mais on en a
  // aussi besoin pour les INSERT post-migration.
  await client.execute('PRAGMA foreign_keys = OFF');
  await client.executeMultiple(LEGACY_ECRITURES_SQL);
  return { client, db: wrapClient(client) };
}

describe('migrateEcrituresStatus', () => {
  let client: Client;
  let db: ReturnType<typeof wrapClient>;

  beforeEach(async () => {
    const setup = await setupLegacyDb();
    client = setup.client;
    db = setup.db;
  });

  it('remappe brouillon → draft, valide → pending_sync, saisie_comptaweb → mirror', async () => {
    // Insère une écriture pour chaque ancien statut.
    await db.exec(`
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status)
      VALUES
        ('e-brouillon', 'g1', '2026-01-01', 'Brouillon', 1000, 'depense', 'brouillon'),
        ('e-valide',    'g1', '2026-01-02', 'Validée',   2000, 'depense', 'valide'),
        ('e-saisie',    'g1', '2026-01-03', 'Saisie CW', 3000, 'recette', 'saisie_comptaweb');
    `);

    await migrateEcrituresStatus(db);

    const rows = await db
      .prepare('SELECT id, status FROM ecritures ORDER BY id')
      .all<{ id: string; status: string }>();
    expect(rows).toEqual([
      { id: 'e-brouillon', status: 'draft' },
      { id: 'e-saisie', status: 'mirror' },
      { id: 'e-valide', status: 'pending_sync' },
    ]);
  });

  it("préserve TOUTES les colonnes et lignes (pas de perte de données)", async () => {
    await db.exec(`
      INSERT INTO ecritures (
        id, group_id, unite_id, date_ecriture, description, amount_cents, type,
        category_id, mode_paiement_id, activite_id, carte_id, numero_piece,
        status, justif_attendu, comptaweb_synced, ligne_bancaire_id,
        ligne_bancaire_sous_index, comptaweb_ecriture_id, notes,
        created_at, updated_at
      )
      VALUES (
        'e-full', 'g1', 'u1', '2026-02-15', 'Toutes les colonnes', 4242, 'depense',
        'cat-1', 'mp-1', 'act-1', 'carte-1', 'CB-2026-001',
        'valide', 0, 1, 12345,
        2, 67890, 'notes libres',
        '2026-02-15T10:00:00Z', '2026-02-15T11:00:00Z'
      );
    `);

    await migrateEcrituresStatus(db);

    const row = await db
      .prepare("SELECT * FROM ecritures WHERE id = 'e-full'")
      .get<Record<string, unknown>>();
    expect(row).toMatchObject({
      id: 'e-full',
      group_id: 'g1',
      unite_id: 'u1',
      date_ecriture: '2026-02-15',
      description: 'Toutes les colonnes',
      amount_cents: 4242,
      type: 'depense',
      category_id: 'cat-1',
      mode_paiement_id: 'mp-1',
      activite_id: 'act-1',
      carte_id: 'carte-1',
      numero_piece: 'CB-2026-001',
      status: 'pending_sync',
      justif_attendu: 0,
      comptaweb_synced: 1,
      ligne_bancaire_id: 12345,
      ligne_bancaire_sous_index: 2,
      comptaweb_ecriture_id: 67890,
      notes: 'notes libres',
      created_at: '2026-02-15T10:00:00Z',
      updated_at: '2026-02-15T11:00:00Z',
    });
  });

  it("retire le CHECK SQL — les nouveaux statuts (pending_cw, divergent) sont insérables", async () => {
    await migrateEcrituresStatus(db);

    // Aucun INSERT ne doit lever : si la CHECK persistait, ces valeurs
    // déclencheraient `SQLITE_CONSTRAINT_CHECK`.
    await db.exec(`
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status)
      VALUES
        ('e-new-pending-cw', 'g1', '2026-03-01', 'En cours envoi', 100, 'depense', 'pending_cw'),
        ('e-new-divergent',  'g1', '2026-03-02', 'Divergent',     200, 'depense', 'divergent');
    `);

    const rows = await db
      .prepare("SELECT id, status FROM ecritures WHERE id LIKE 'e-new-%' ORDER BY id")
      .all<{ id: string; status: string }>();
    expect(rows).toEqual([
      { id: 'e-new-divergent', status: 'divergent' },
      { id: 'e-new-pending-cw', status: 'pending_cw' },
    ]);
  });

  it("recrée le DEFAULT 'draft' (les nouveaux INSERT sans status sont en draft)", async () => {
    await migrateEcrituresStatus(db);
    await db.exec(`
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type)
      VALUES ('e-default', 'g1', '2026-03-03', 'Sans status', 50, 'depense');
    `);
    const row = await db
      .prepare("SELECT status FROM ecritures WHERE id = 'e-default'")
      .get<{ status: string }>();
    expect(row?.status).toBe('draft');
  });

  it('est idempotent : un 2e appel ne casse rien', async () => {
    await db.exec(`
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status)
      VALUES ('e-1', 'g1', '2026-01-01', 'X', 1000, 'depense', 'valide');
    `);

    await migrateEcrituresStatus(db);
    await migrateEcrituresStatus(db);

    const row = await db
      .prepare("SELECT status FROM ecritures WHERE id = 'e-1'")
      .get<{ status: string }>();
    expect(row?.status).toBe('pending_sync');

    // Les indexes doivent toujours exister.
    const indexes = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ecritures' ORDER BY name",
      )
      .all<{ name: string }>();
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_ecritures_group');
    expect(indexNames).toContain('idx_ecritures_status');
    expect(indexNames).toContain('idx_ecritures_carte');
  });

  it("recrée les indexes (group, unite, date, type, status, ligne_bancaire, carte)", async () => {
    await migrateEcrituresStatus(db);
    const indexes = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ecritures' ORDER BY name",
      )
      .all<{ name: string }>();
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_ecritures_group');
    expect(names).toContain('idx_ecritures_unite');
    expect(names).toContain('idx_ecritures_date');
    expect(names).toContain('idx_ecritures_type');
    expect(names).toContain('idx_ecritures_status');
    expect(names).toContain('idx_ecritures_ligne_bancaire');
    expect(names).toContain('idx_ecritures_carte');
  });
});
