// Tests de la migration « titres parlants » (spec 2026-06-30) :
// ajout de ecritures.libelle_origine + backfill ciblé des brouillons bancaires
// encore bruts (sans toucher les titres déjà soignés ni les mirror).

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient } from '../db';
import { ensureEcrituresLibelleOrigine } from './business-schema';

type Db = ReturnType<typeof wrapClient>;

async function setupDb(): Promise<{ client: Client; db: Db }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  return { client, db: wrapClient(client) };
}

// Table ecritures SANS libelle_origine (forme antérieure à la migration).
async function createEcrituresAvantMigration(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      date_ecriture TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      ligne_bancaire_id INTEGER
    );
  `);
}

async function insert(
  db: Db,
  o: { id: string; description: string; status?: string; ligne?: number | null },
) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, ligne_bancaire_id)
       VALUES (?, 'g', '2026-06-23', ?, 4500, 'recette', ?, ?)`,
    )
    .run(o.id, o.description, o.status ?? 'draft', o.ligne ?? null);
}

async function libelle(db: Db, id: string): Promise<string | null> {
  const r = await db.prepare('SELECT libelle_origine FROM ecritures WHERE id = ?').get<{ libelle_origine: string | null }>(id);
  return r?.libelle_origine ?? null;
}

describe('ensureEcrituresLibelleOrigine', () => {
  let db: Db;
  beforeEach(async () => { db = (await setupDb()).db; });

  it('ajoute la colonne libelle_origine (idempotent)', async () => {
    await createEcrituresAvantMigration(db);
    await ensureEcrituresLibelleOrigine(db);
    const cols = await db.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>();
    expect(cols.some((c) => c.name === 'libelle_origine')).toBe(true);
    // 2e passage : ne plante pas (ALTER gardé par PRAGMA).
    await ensureEcrituresLibelleOrigine(db);
  });

  it('backfille un brouillon bancaire brut (PAIEMENT C. PROC…)', async () => {
    await createEcrituresAvantMigration(db);
    await insert(db, { id: 'E1', description: 'PAIEMENT C. PROC AMAZON 123 FR FRANCE', ligne: 111 });
    await ensureEcrituresLibelleOrigine(db);
    expect(await libelle(db, 'E1')).toBe('PAIEMENT C. PROC AMAZON 123 FR FRANCE');
  });

  it('épargne un brouillon bancaire déjà renommé (titre soigné)', async () => {
    await createEcrituresAvantMigration(db);
    await insert(db, { id: 'E2', description: 'Tentes Décathlon camp été', ligne: 222 });
    await ensureEcrituresLibelleOrigine(db);
    expect(await libelle(db, 'E2')).toBeNull();
  });

  it('épargne une écriture déjà dans CW (mirror), même au libellé brut', async () => {
    await createEcrituresAvantMigration(db);
    await insert(db, { id: 'E3', description: 'VIR DUPONT FR FRANCE', status: 'mirror', ligne: 333 });
    await ensureEcrituresLibelleOrigine(db);
    expect(await libelle(db, 'E3')).toBeNull();
  });

  it('épargne une écriture saisie manuellement (sans ligne bancaire)', async () => {
    await createEcrituresAvantMigration(db);
    await insert(db, { id: 'E4', description: 'PAIEMENT C. PROC truc', ligne: null });
    await ensureEcrituresLibelleOrigine(db);
    expect(await libelle(db, 'E4')).toBeNull();
  });

  it('n’écrase jamais un libelle_origine déjà posé', async () => {
    await createEcrituresAvantMigration(db);
    await insert(db, { id: 'E5', description: 'PAIEMENT C. PROC X FR FRANCE', ligne: 555 });
    await ensureEcrituresLibelleOrigine(db); // pose E5
    // Simule un renommage user APRÈS coup : description change, libelle_origine garde le brut.
    await db.prepare("UPDATE ecritures SET description = 'Achat X' WHERE id = 'E5'").run();
    await ensureEcrituresLibelleOrigine(db); // 2e passage
    expect(await libelle(db, 'E5')).toBe('PAIEMENT C. PROC X FR FRANCE');
  });
});
