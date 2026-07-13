// Self-heal des drafts DSP2 mal orientés (bug de signe 2026-07-02).
//
// Avant le fix, les sous-lignes DSP2 d'un « PAIEMENT C. PROC … » (paiement
// carte, ligne parent négative) étaient créées en `recette` (montant détail
// positif). Le fix de parsing corrige les NOUVELLES lignes, mais les drafts
// déjà créés à tort sont reconnus « existants » au scan suivant et ne se
// recalculent jamais. scanDraftsFromComptaweb doit donc corriger sur place le
// TYPE d'un draft NU (status draft, pas imputé, pas rattaché, pas lié à CW)
// dont le sens ne correspond plus au candidat recalculé — sans jamais toucher
// un draft enrichi par l'utilisateur.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

const bankLinesRef: { value: unknown[] } = { value: [] };
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async () => ({ ecrituresBancaires: bankLinesRef.value }),
  listRapprochementBancaire: vi.fn(),
  createEcriture: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
let idCounter = 0;
vi.mock('../../ids', () => ({
  nextId: async (prefix: string) => `${prefix}-NEW-${++idCounter}`,
  currentTimestamp: () => '2026-07-02T09:00:00Z',
}));

import { scanDraftsFromComptaweb } from '../drafts';

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT,
    date_ecriture TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL, category_id TEXT, mode_paiement_id TEXT, activite_id TEXT,
    numero_piece TEXT, status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1, comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER, ligne_bancaire_sous_index INTEGER,
    comptaweb_ecriture_id INTEGER, carte_id TEXT, libelle_origine TEXT, ventilation_group_id TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-06-25T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-06-25T00:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT);
`;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return db;
}

// Ligne parent négative (dépense carte) avec 1 sous-ligne DSP2 déjà SIGNÉE
// négatif (sortie du parser corrigé).
function bankLineCarte(id: number) {
  return {
    id,
    dateOperation: '2026-06-01',
    montantCentimes: -18644,
    intitule: 'PAIEMENT C. PROC PBWD76QHY',
    sousLignes: [{ montantCentimes: -4794, commercant: 'AUCHANSUPERMAR4727409' }],
  };
}

// Draft déjà créé à tort en recette pour la sous-ligne 0 de cette ligne.
async function insertWrongDraft(
  db: DbWrapper,
  o: { id: string; ligneId: number; categoryId?: string | null },
) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
         category_id, status, justif_attendu, ligne_bancaire_id, ligne_bancaire_sous_index)
       VALUES (?, 'g', '2026-06-01', 'AUCHANSUPERMAR4727409', 4794, 'recette', ?, 'draft', 0, ?, 0)`,
    )
    .run(o.id, o.categoryId ?? null, o.ligneId);
}

async function readDraft(db: DbWrapper, id: string) {
  return db
    .prepare('SELECT type, justif_attendu, amount_cents FROM ecritures WHERE id = ?')
    .get<{ type: string; justif_attendu: number; amount_cents: number }>(id);
}

describe('scanDraftsFromComptaweb — self-heal des drafts DSP2 mal orientés', () => {
  beforeEach(() => { idCounter = 0; bankLinesRef.value = []; });

  it('corrige un draft NU recette → dépense quand le parent est une dépense', async () => {
    const db = await setupDb();
    await insertWrongDraft(db, { id: 'ECR-WRONG', ligneId: 19300000 });
    bankLinesRef.value = [bankLineCarte(19300000)];

    const res = await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    expect(res.crees).toBe(0);
    expect(res.corriges).toBe(1);
    const d = await readDraft(db, 'ECR-WRONG');
    expect(d?.type).toBe('depense');
    expect(d?.justif_attendu).toBe(1); // une dépense attend un justif
    expect(d?.amount_cents).toBe(4794); // montant absolu inchangé
  });

  it('ne recrée PAS de doublon (le draft corrigé reste unique)', async () => {
    const db = await setupDb();
    await insertWrongDraft(db, { id: 'ECR-WRONG', ligneId: 19300000 });
    bankLinesRef.value = [bankLineCarte(19300000)];

    await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    const n = await db.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('corrige un draft imputé SANS perdre l’imputation (le type n’est pas éditable à la main)', async () => {
    const db = await setupDb();
    await insertWrongDraft(db, { id: 'ECR-IMPUTE', ligneId: 19300000, categoryId: 'c1' });
    bankLinesRef.value = [bankLineCarte(19300000)];

    const res = await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    expect(res.corriges).toBe(1);
    const d = await db
      .prepare('SELECT type, category_id FROM ecritures WHERE id = ?')
      .get<{ type: string; category_id: string | null }>('ECR-IMPUTE');
    expect(d?.type).toBe('depense'); // sens corrigé
    expect(d?.category_id).toBe('c1'); // imputation préservée
  });

  it('corrige un draft rattaché à un DÉPÔT sans casser le lien dépôt', async () => {
    const db = await setupDb();
    await insertWrongDraft(db, { id: 'ECR-DEPOT', ligneId: 19300000 });
    await db
      .prepare("INSERT INTO depots_justificatifs (id, ecriture_id) VALUES ('DEP-1', 'ECR-DEPOT')")
      .run();
    bankLinesRef.value = [bankLineCarte(19300000)];

    const res = await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    expect(res.corriges).toBe(1);
    const d = await readDraft(db, 'ECR-DEPOT');
    expect(d?.type).toBe('depense');
    // Le dépôt reste rattaché à la MÊME écriture (pas de suppression/recréation).
    const link = await db
      .prepare("SELECT ecriture_id FROM depots_justificatifs WHERE id = 'DEP-1'")
      .get<{ ecriture_id: string }>();
    expect(link?.ecriture_id).toBe('ECR-DEPOT');
  });

  it('ne touche JAMAIS une écriture déjà dans Comptaweb (mirror / liée CW)', async () => {
    const db = await setupDb();
    await db
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
           status, justif_attendu, ligne_bancaire_id, ligne_bancaire_sous_index, comptaweb_ecriture_id)
         VALUES ('ECR-CW', 'g', '2026-06-01', 'AUCHANSUPERMAR4727409', 4794, 'recette',
           'mirror', 0, 19300000, 0, 555)`,
      )
      .run();
    bankLinesRef.value = [bankLineCarte(19300000)];

    const res = await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    expect(res.corriges).toBe(0);
    const d = await readDraft(db, 'ECR-CW');
    expect(d?.type).toBe('recette'); // intouchable : déjà matérialisée dans CW
  });
});
