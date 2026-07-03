// Ids de lignes bancaires Comptaweb INSTABLES (recyclés entre transactions).
//
// Cas terrain 2026-07-03 : la ligne bancaire 19105752 a d'abord porté le
// paiement GABORIAUD (+45 €, validé → mirror), puis CW a réutilisé le même id
// 19105752 pour une NOUVELLE ligne DEGOMME (+45 €). scanDrafts reconnaissait
// « déjà traitée » par (ligne_bancaire_id, sous_index) seul → il trouvait
// l'écriture GABORIAUD sous cet id et NE créait PAS le draft DEGOMME.
//
// Fix : reconnaissance par CONTENU (montant + libellé brut), pas par le seul id.

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
  currentTimestamp: () => '2026-07-03T09:00:00Z',
}));

import { scanDraftsFromComptaweb } from '../drafts';

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
    category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER, carte_id TEXT,
    libelle_origine TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-06-25T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-06-25T00:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT);
`;

const LIGNE_ID = 19105752;
const GABORIAUD = 'GABORIAUD SARDA SARDA JULIETTE ZZ1KP4XS2G5XG58BM FR FRANCE';
const DEGOMME = 'MR DEGOMME M OU ME STRICKLAND C DEGOMME LOUISE CAMP FARFA 2026 VIREMENT DE MR DEGOMME M OU ME FR FRANCE';

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return db;
}

// La ligne bancaire porte l'intitulé brut ; scanDrafts en dérive libelProposal.
function bankLine(id: number, intitule: string) {
  return { id, dateOperation: '2026-06-23', montantCentimes: 4500, intitule, sousLignes: [] };
}

async function insertMirror(db: DbWrapper, o: { id: string; ligneId: number; description: string }) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
         status, comptaweb_synced, ligne_bancaire_id, comptaweb_ecriture_id)
       VALUES (?, 'val-de-saone', '2026-06-23', ?, 4500, 'recette', 'mirror', 1, ?, 2423148)`,
    )
    .run(o.id, o.description, o.ligneId);
}

async function insertDraft(db: DbWrapper, o: { id: string; ligneId: number; libelleOrigine: string }) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine, amount_cents,
         type, status, ligne_bancaire_id)
       VALUES (?, 'val-de-saone', '2026-06-23', ?, ?, 4500, 'recette', 'draft', ?)`,
    )
    .run(o.id, o.libelleOrigine, o.libelleOrigine, o.ligneId);
}

async function count(db: DbWrapper): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
  return r?.n ?? 0;
}

describe('scanDraftsFromComptaweb — ids de lignes bancaires recyclés', () => {
  beforeEach(() => { idCounter = 0; bankLinesRef.value = []; });

  it('crée le draft d\'une nouvelle transaction sous un id recyclé (contenu différent d\'une écriture validée)', async () => {
    const db = await setupDb();
    // GABORIAUD validé, sous l'id 19105752.
    await insertMirror(db, { id: 'ECR-389', ligneId: LIGNE_ID, description: GABORIAUD });
    // Même id, mais c'est maintenant DEGOMME.
    bankLinesRef.value = [bankLine(LIGNE_ID, DEGOMME)];

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    expect(res.crees).toBe(1);
    expect(await count(db)).toBe(2); // GABORIAUD (mirror) + nouveau draft DEGOMME
  });

  it('ne recrée PAS de doublon au re-scan (le draft de la nouvelle transaction est reconnu par contenu)', async () => {
    const db = await setupDb();
    // Libellé court sans suite de 6+ chiffres → cleanLabel le laisse intact,
    // donc l'intitulé de la ligne == libelle_origine du draft (match contenu).
    const DEGOMME_SHORT = 'DEGOMME LOUISE CAMP FARFA VIREMENT';
    await insertMirror(db, { id: 'ECR-389', ligneId: LIGNE_ID, description: GABORIAUD });
    await insertDraft(db, { id: 'ECR-DEGOMME', ligneId: LIGNE_ID, libelleOrigine: DEGOMME_SHORT });
    bankLinesRef.value = [bankLine(LIGNE_ID, DEGOMME_SHORT)];

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    expect(res.crees).toBe(0);
    expect(res.existants).toBe(1);
    expect(await count(db)).toBe(2);
  });

  it('vraie re-visite (même id, même contenu) → existant, pas de création', async () => {
    const db = await setupDb();
    const libelProposal = 'GABORIAUD SARDA SARDA JULIETTE ZZ1KP4XS2G5XG58BM FR FRANCE';
    await insertDraft(db, { id: 'ECR-G', ligneId: LIGNE_ID, libelleOrigine: libelProposal });
    bankLinesRef.value = [bankLine(LIGNE_ID, GABORIAUD)];

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    expect(res.crees).toBe(0);
    expect(res.existants).toBe(1);
    expect(await count(db)).toBe(1);
  });
});
