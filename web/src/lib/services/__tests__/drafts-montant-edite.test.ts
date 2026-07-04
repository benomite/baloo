// Le MONTANT d'un draft bancaire est ÉDITABLE (l'utilisateur corrige les
// erreurs du relevé de banque). Il ne doit donc PAS faire partie de la clé
// d'identité « ce draft représente-t-il déjà cette sous-ligne ? ».
//
// Cas terrain 2026-07-04 : ligne « PAIEMENT C. PROC PBWD76QHY », sous-ligne
// LECLERCGENAY affichée -217,10 par la banque, mais la dépense réelle
// (justif) est -217,12 (le relevé sous-compte de 2 centimes). L'utilisateur
// corrige le draft à 217,12. Au scan suivant, le match incluait
// `amount_cents == amountAbs` → 21712 ≠ 21710 → match raté → un NOUVEAU draft
// à 217,10 était recréé (doublon).
//
// Fix : match par `sous_index + libelle_origine` (stables), sans le montant.

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
  currentTimestamp: () => '2026-07-04T09:00:00Z',
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

const LIGNE_ID = 19102436;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return db;
}

// Ligne bancaire à sous-lignes DSP2 (montants signés, cf. fix 2026-07-02).
function bankLineWithSousLignes(
  id: number,
  sousLignes: Array<{ commercant: string; montantCentimes: number }>,
) {
  return {
    id,
    dateOperation: '2026-06-22',
    montantCentimes: sousLignes.reduce((s, sl) => s + sl.montantCentimes, 0),
    intitule: 'PAIEMENT C. PROC PBWD76QHY',
    sousLignes,
  };
}

async function insertDraft(
  db: DbWrapper,
  o: { id: string; sousIndex: number; libelleOrigine: string; amountCents: number },
) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine, amount_cents,
         type, status, ligne_bancaire_id, ligne_bancaire_sous_index)
       VALUES (?, 'val-de-saone', '2026-06-22', ?, ?, ?, 'depense', 'draft', ?, ?)`,
    )
    .run(o.id, o.libelleOrigine, o.libelleOrigine, o.amountCents, LIGNE_ID, o.sousIndex);
}

// Écriture VALIDÉE (mirror, dans CW) — cas réel : le draft a été validé, son
// montant corrigé, puis la ligne bancaire reste non rapprochée côté CW. La
// description a pu être renommée (titre parlant) ; `libelle_origine` reste figé.
async function insertMirror(
  db: DbWrapper,
  o: { id: string; sousIndex: number; libelleOrigine: string; description: string; amountCents: number },
) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine, amount_cents,
         type, status, comptaweb_synced, comptaweb_ecriture_id, ligne_bancaire_id, ligne_bancaire_sous_index)
       VALUES (?, 'val-de-saone', '2026-06-22', ?, ?, ?, 'depense', 'mirror', 1, 2430378, ?, ?)`,
    )
    .run(o.id, o.description, o.libelleOrigine, o.amountCents, LIGNE_ID, o.sousIndex);
}

async function count(db: DbWrapper): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
  return r?.n ?? 0;
}

describe('scanDraftsFromComptaweb — montant de draft corrigé (erreur de relevé)', () => {
  beforeEach(() => {
    idCounter = 0;
    bankLinesRef.value = [];
  });

  it('ne recrée PAS de doublon quand le montant du draft a été corrigé (217,12 vs 217,10 bancaire)', async () => {
    const db = await setupDb();
    // Draft déjà créé pour la sous-ligne 0 (LECLERCGENAY), montant CORRIGÉ à
    // 217,12 par l'utilisateur (le relevé affiche 217,10, erreur de 2 cts).
    await insertDraft(db, {
      id: 'ECR-LECLERC',
      sousIndex: 0,
      libelleOrigine: 'LECLERCGENAY',
      amountCents: 21712,
    });
    // La banque renvoie toujours 217,10 sur cette sous-ligne.
    bankLinesRef.value = [
      bankLineWithSousLignes(LIGNE_ID, [
        { commercant: 'LECLERCGENAY', montantCentimes: -21710 },
        { commercant: 'APRR', montantCentimes: -170 },
      ]),
    ];

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    // La sous-ligne 0 est reconnue (par sous_index + libellé), pas recréée ;
    // seule la sous-ligne 1 (APRR) est nouvelle.
    expect(res.crees).toBe(1); // APRR uniquement
    expect(res.existants).toBe(1); // LECLERCGENAY reconnu malgré le montant différent
    expect(await count(db)).toBe(2); // LECLERC corrigé + APRR neuf, PAS de doublon LECLERC

    // Le montant corrigé n'a pas été écrasé.
    const leclerc = await db
      .prepare('SELECT amount_cents AS a FROM ecritures WHERE id = ?')
      .get<{ a: number }>('ECR-LECLERC');
    expect(leclerc?.a).toBe(21712);
  });

  it('écriture VALIDÉE (mirror, renommée, montant corrigé) reconnue → aucun draft parasite (cas ECR-2026-442)', async () => {
    const db = await setupDb();
    // Le draft LECLERCGENAY a été validé (mirror), renommé « courses… » et son
    // montant corrigé à 217,12. La banque affiche toujours 217,10.
    await insertMirror(db, {
      id: 'ECR-442',
      sousIndex: 0,
      libelleOrigine: 'LECLERCGENAY',
      description: 'courses weekend de groupe',
      amountCents: 21712,
    });
    bankLinesRef.value = [
      bankLineWithSousLignes(LIGNE_ID, [{ commercant: 'LECLERCGENAY', montantCentimes: -21710 }]),
    ];

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    // Reconnue par sous_index + libelle_origine malgré montant ET description
    // différents → PAS de draft parasite à 217,10.
    expect(res.crees).toBe(0);
    expect(res.existants).toBe(1);
    expect(await count(db)).toBe(1);
  });

  it('re-visite normale (montant non modifié) → toujours reconnu existant', async () => {
    const db = await setupDb();
    await insertDraft(db, {
      id: 'ECR-LECLERC',
      sousIndex: 0,
      libelleOrigine: 'LECLERCGENAY',
      amountCents: 21710,
    });
    bankLinesRef.value = [
      bankLineWithSousLignes(LIGNE_ID, [{ commercant: 'LECLERCGENAY', montantCentimes: -21710 }]),
    ];

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    expect(res.crees).toBe(0);
    expect(res.existants).toBe(1);
    expect(await count(db)).toBe(1);
  });
});
