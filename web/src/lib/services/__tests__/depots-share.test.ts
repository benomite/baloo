// Paiement scindé en 2 (souci carte) : 1 justif déposé via /depot correspond à
// 2 écritures. `shareDepotToEcriture` rattache le justif d'un dépôt DÉJÀ
// rattaché (écriture A) à une 2ᵉ écriture B, sans toucher au dépôt ni à A.
//
// Point clé : le blob n'est jamais déplacé (file_path figé « depot/<id>/… »),
// on retrouve donc les fichiers du dépôt par file_path même après migration,
// et on crée une nouvelle ligne justificatifs vers le MÊME blob (partage).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
let jusSeq = 0;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-${++jusSeq}`,
  currentTimestamp: () => '2026-07-04T10:00:00Z',
}));

import { shareDepotToEcriture } from '../depots';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE depots_justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, submitted_by_user_id TEXT, titre TEXT NOT NULL,
      description TEXT, category_id TEXT, unite_id TEXT, amount_cents INTEGER,
      date_estimee TEXT, carte_id TEXT, activite_id TEXT, statut TEXT NOT NULL DEFAULT 'a_traiter',
      ecriture_id TEXT, motif_rejet TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      libelle_origine TEXT, amount_cents INTEGER, type TEXT, status TEXT,
      category_id TEXT, unite_id TEXT, carte_id TEXT, activite_id TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, file_path TEXT NOT NULL,
      original_filename TEXT NOT NULL, mime_type TEXT, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, uploaded_at TEXT
    );
  `);
  return db;
}

async function insertDepot(
  db: DbWrapper,
  o: Partial<{ statut: string; ecritureId: string; titre: string; categoryId: string; uniteId: string; activiteId: string; carteId: string }> = {},
) {
  await db
    .prepare(
      `INSERT INTO depots_justificatifs
         (id, group_id, submitted_by_user_id, titre, statut, ecriture_id, category_id, unite_id, activite_id, carte_id)
       VALUES ('DEP-1', 'g', 'u1', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      o.titre ?? 'Courses LECLERC',
      o.statut ?? 'rattache',
      o.ecritureId ?? 'ECR-A',
      o.categoryId ?? 'cat-intendance',
      o.uniteId ?? 'u-groupe',
      o.activiteId ?? 'act-annee',
      o.carteId ?? 'carte-benoit',
    );
}

async function insertEcriture(
  db: DbWrapper,
  o: { id: string; status?: string; description?: string; libelleOrigine?: string | null; categoryId?: string | null; uniteId?: string | null },
) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine, amount_cents, type, status, category_id, unite_id)
       VALUES (?, 'g', '2026-06-22', ?, ?, 21710, 'depense', ?, ?, ?)`,
    )
    .run(o.id, o.description ?? 'LECLERCGENAY', o.libelleOrigine ?? null, o.status ?? 'draft', o.categoryId ?? null, o.uniteId ?? null);
}

// Fichier justif d'un dépôt : file_path figé « depot/DEP-1/… » ; entity_id
// pointe l'écriture A après le 1er rattachement (migration).
async function insertJustifOnA(db: DbWrapper, o: { path: string; filename: string; entityId?: string }) {
  await db
    .prepare(
      `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
       VALUES (?, 'g', ?, ?, 'image/jpeg', 'ecriture', ?, '2026-06-25T00:00:00Z')`,
    )
    .run(`JUS-seed-${o.path}`, o.path, o.filename, o.entityId ?? 'ECR-A');
}

async function justifsOn(db: DbWrapper, ecritureId: string) {
  return db
    .prepare(`SELECT file_path, original_filename, mime_type FROM justificatifs WHERE entity_type='ecriture' AND entity_id=? ORDER BY file_path`)
    .all<{ file_path: string; original_filename: string; mime_type: string }>(ecritureId);
}

describe('shareDepotToEcriture', () => {
  beforeEach(async () => {
    jusSeq = 0;
    testDb = await setup();
  });

  it('copie le justif du dépôt sur la 2ᵉ écriture (même blob) sans toucher au dépôt ni à A', async () => {
    await insertDepot(testDb, { statut: 'rattache', ecritureId: 'ECR-A' });
    await insertEcriture(testDb, { id: 'ECR-A', status: 'mirror' });
    await insertEcriture(testDb, { id: 'ECR-B', status: 'draft', libelleOrigine: 'LECLERCGENAY', description: 'LECLERCGENAY' });
    await insertJustifOnA(testDb, { path: 'depot/DEP-1/JUS-1-ticket.jpg', filename: 'ticket.jpg' });

    const res = await shareDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-B');

    expect(res.copied).toBe(1);
    const onB = await justifsOn(testDb, 'ECR-B');
    expect(onB).toHaveLength(1);
    expect(onB[0].file_path).toBe('depot/DEP-1/JUS-1-ticket.jpg'); // blob partagé
    // A garde son justif.
    expect(await justifsOn(testDb, 'ECR-A')).toHaveLength(1);
    // Dépôt inchangé.
    const dep = await testDb.prepare('SELECT statut, ecriture_id FROM depots_justificatifs WHERE id=?').get<{ statut: string; ecriture_id: string }>('DEP-1');
    expect(dep).toEqual({ statut: 'rattache', ecriture_id: 'ECR-A' });
  });

  it('idempotent : un 2ᵉ appel ne recrée pas de doublon sur B', async () => {
    await insertDepot(testDb);
    await insertEcriture(testDb, { id: 'ECR-A', status: 'mirror' });
    await insertEcriture(testDb, { id: 'ECR-B', status: 'draft' });
    await insertJustifOnA(testDb, { path: 'depot/DEP-1/JUS-1-ticket.jpg', filename: 'ticket.jpg' });

    await shareDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-B');
    const res2 = await shareDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-B');

    expect(res2.copied).toBe(0);
    expect(await justifsOn(testDb, 'ECR-B')).toHaveLength(1);
  });

  it('draft cible : hérite imputation (champs vides) + titre, sans écraser une valeur saisie', async () => {
    await insertDepot(testDb, { titre: 'Courses LECLERC', categoryId: 'cat-intendance', uniteId: 'u-groupe', activiteId: 'act-annee', carteId: 'carte-benoit' });
    await insertEcriture(testDb, { id: 'ECR-A', status: 'mirror' });
    // B draft : unité déjà saisie (u-DEJA), catégorie vide, titre = libellé brut.
    await insertEcriture(testDb, { id: 'ECR-B', status: 'draft', description: 'LECLERCGENAY', libelleOrigine: 'LECLERCGENAY', uniteId: 'u-DEJA', categoryId: null });
    await insertJustifOnA(testDb, { path: 'depot/DEP-1/JUS-1-ticket.jpg', filename: 'ticket.jpg' });

    await shareDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-B');

    const b = await testDb.prepare('SELECT description, category_id, unite_id, activite_id, carte_id FROM ecritures WHERE id=?').get<Record<string, string | null>>('ECR-B');
    expect(b?.category_id).toBe('cat-intendance'); // vide → hérité
    expect(b?.unite_id).toBe('u-DEJA'); // saisi → PAS écrasé
    expect(b?.activite_id).toBe('act-annee');
    expect(b?.carte_id).toBe('carte-benoit');
    expect(b?.description).toBe('Courses LECLERC'); // titre brut → hérité
  });

  it('écriture cible NON draft (mirror) : justif copié mais imputation/titre inchangés', async () => {
    await insertDepot(testDb, { categoryId: 'cat-intendance' });
    await insertEcriture(testDb, { id: 'ECR-A', status: 'mirror' });
    await insertEcriture(testDb, { id: 'ECR-B', status: 'mirror', description: 'Autre libellé', categoryId: null });
    await insertJustifOnA(testDb, { path: 'depot/DEP-1/JUS-1-ticket.jpg', filename: 'ticket.jpg' });

    const res = await shareDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-B');

    expect(res.copied).toBe(1);
    const b = await testDb.prepare('SELECT description, category_id FROM ecritures WHERE id=?').get<Record<string, string | null>>('ECR-B');
    expect(b?.category_id).toBeNull(); // non-draft → pas d'héritage
    expect(b?.description).toBe('Autre libellé');
  });

  it('multi-fichiers : les 2 fichiers du dépôt sont copiés', async () => {
    await insertDepot(testDb);
    await insertEcriture(testDb, { id: 'ECR-A', status: 'mirror' });
    await insertEcriture(testDb, { id: 'ECR-B', status: 'draft' });
    await insertJustifOnA(testDb, { path: 'depot/DEP-1/JUS-1-recto.jpg', filename: 'recto.jpg' });
    await insertJustifOnA(testDb, { path: 'depot/DEP-1/JUS-2-verso.jpg', filename: 'verso.jpg' });

    const res = await shareDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-B');

    expect(res.copied).toBe(2);
    expect(await justifsOn(testDb, 'ECR-B')).toHaveLength(2);
  });

  it('dépôt sans fichier → throw explicite', async () => {
    await insertDepot(testDb);
    await insertEcriture(testDb, { id: 'ECR-B', status: 'draft' });
    await expect(shareDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-B')).rejects.toThrow(/justificatif/i);
  });

  it('écriture cible introuvable → throw', async () => {
    await insertDepot(testDb);
    await insertJustifOnA(testDb, { path: 'depot/DEP-1/JUS-1-ticket.jpg', filename: 'ticket.jpg' });
    await expect(shareDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-ABSENT')).rejects.toThrow(/introuvable/i);
  });
});
