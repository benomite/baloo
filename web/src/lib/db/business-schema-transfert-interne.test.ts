// Migration #51 : la CHECK SQL de `ecritures.type` accepte 'transfert_interne'
// et la colonne `mode_transfert` existe — sans perdre une ligne ni une colonne
// ajoutée par ALTER au fil des chantiers.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { migrateEcrituresTransfertInterne } from './business-schema';

// Table telle qu'une BDD de prod l'a avant #51 : CHECK à deux valeurs, plus
// les colonnes ajoutées par ALTER (cw_numero_piece, ventilation_group_id,
// libelle_origine, cw_signature).
const AVANT_51 = `
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
    status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    comptaweb_ecriture_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
  );
  ALTER TABLE ecritures ADD COLUMN cw_numero_piece TEXT;
  ALTER TABLE ecritures ADD COLUMN ventilation_group_id TEXT;
  ALTER TABLE ecritures ADD COLUMN libelle_origine TEXT;
  ALTER TABLE ecritures ADD COLUMN cw_signature TEXT;
  INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status,
      cw_numero_piece, ventilation_group_id, libelle_origine, cw_signature, notes)
    VALUES ('E1', 'g1', '2026-10-03', 'VERSEMENT ESPECES', 25000, 'recette', 'draft',
      'CW-1', 'vg_1', 'VERSEMENT ESPECES', 'sig', 'note'),
           ('E2', 'g1', '2026-10-04', 'Achat', 1200, 'depense', 'mirror', NULL, NULL, NULL, NULL, NULL);
`;

let db: DbWrapper;

async function colonnes(): Promise<string[]> {
  return (await db.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>()).map((c) => c.name);
}

async function index(): Promise<string[]> {
  return (
    await db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ecritures' AND name LIKE 'idx_%'")
      .all<{ name: string }>()
  ).map((r) => r.name);
}

describe('migrateEcrituresTransfertInterne', () => {
  beforeEach(async () => {
    db = wrapClient(createClient({ url: 'file::memory:' }));
  });

  it('élargit la CHECK, ajoute mode_transfert et garde lignes et colonnes', async () => {
    await db.exec(AVANT_51);
    await expect(
      db.prepare("UPDATE ecritures SET type = 'transfert_interne' WHERE id = 'E1'").run(),
    ).rejects.toThrow();

    await migrateEcrituresTransfertInterne(db);

    const cols = await colonnes();
    expect(cols).toEqual(expect.arrayContaining([
      'mode_transfert', 'cw_numero_piece', 'ventilation_group_id', 'libelle_origine', 'cw_signature',
    ]));
    const e1 = await db.prepare("SELECT * FROM ecritures WHERE id = 'E1'").get<Record<string, unknown>>();
    expect(e1).toMatchObject({
      description: 'VERSEMENT ESPECES', amount_cents: 25000, type: 'recette', status: 'draft',
      cw_numero_piece: 'CW-1', ventilation_group_id: 'vg_1', libelle_origine: 'VERSEMENT ESPECES',
      cw_signature: 'sig', notes: 'note', mode_transfert: null,
    });
    const n = await db.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
    expect(n?.n).toBe(2);

    await db
      .prepare("UPDATE ecritures SET type = 'transfert_interne', mode_transfert = 'depot_especes' WHERE id = 'E1'")
      .run();
    const relu = await db.prepare("SELECT type, mode_transfert FROM ecritures WHERE id = 'E1'").get();
    expect(relu).toEqual({ type: 'transfert_interne', mode_transfert: 'depot_especes' });
    // La CHECK reste active pour les autres valeurs.
    await expect(db.prepare("UPDATE ecritures SET type = 'virement' WHERE id = 'E2'").run()).rejects.toThrow();

    expect(await index()).toEqual(expect.arrayContaining([
      'idx_ecritures_group', 'idx_ecritures_type', 'idx_ecritures_status',
      'idx_ecritures_cw_numero_piece', 'idx_ecritures_ventilation_group',
    ]));
  });

  it('idempotente : un second passage ne touche à rien', async () => {
    await db.exec(AVANT_51);
    await migrateEcrituresTransfertInterne(db);
    await db.prepare("UPDATE ecritures SET type = 'transfert_interne', mode_transfert = 'retrait_especes' WHERE id = 'E1'").run();
    await migrateEcrituresTransfertInterne(db);
    const relu = await db.prepare("SELECT type, mode_transfert FROM ecritures WHERE id = 'E1'").get();
    expect(relu).toEqual({ type: 'transfert_interne', mode_transfert: 'retrait_especes' });
  });

  it('CHECK déjà élargie mais colonne absente : ajoute seulement la colonne', async () => {
    await db.exec(`
      CREATE TABLE ecritures (id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('depense', 'recette', 'transfert_interne')));
      INSERT INTO ecritures VALUES ('E1', 'transfert_interne');
    `);
    await migrateEcrituresTransfertInterne(db);
    expect(await colonnes()).toEqual(['id', 'type', 'mode_transfert']);
  });

  it('table sans CHECK sur type : ajoute seulement la colonne, sans reconstruire', async () => {
    await db.exec(`
      CREATE TABLE ecritures (id TEXT PRIMARY KEY, type TEXT NOT NULL, extra TEXT);
      INSERT INTO ecritures VALUES ('E1', 'recette', 'gardé');
    `);
    await migrateEcrituresTransfertInterne(db);
    expect(await colonnes()).toEqual(['id', 'type', 'extra', 'mode_transfert']);
  });

  it('table absente : rien à faire', async () => {
    await migrateEcrituresTransfertInterne(db);
    const t = await db.prepare("SELECT name FROM sqlite_master WHERE name = 'ecritures'").get();
    expect(t).toBeUndefined();
  });

  it('remet les clés étrangères comme elles étaient', async () => {
    await db.exec(AVANT_51);
    await db.exec('PRAGMA foreign_keys = ON');
    await migrateEcrituresTransfertInterne(db);
    const fk = await db.prepare('PRAGMA foreign_keys').get<{ foreign_keys: number }>();
    expect(fk?.foreign_keys).toBe(1);
  });

  it('les laisse coupées si elles l’étaient', async () => {
    await db.exec(AVANT_51);
    await db.exec('PRAGMA foreign_keys = OFF');
    await migrateEcrituresTransfertInterne(db);
    const fk = await db.prepare('PRAGMA foreign_keys').get<{ foreign_keys: number }>();
    expect(fk?.foreign_keys).toBe(0);
  });
});
