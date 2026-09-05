// Une FK vers l'écriture ne doit pas faire sauter TOUT le scan de drafts.
//
// Cas terrain 2026-09-05 : le trésorier avait rejeté une suggestion inbox sur
// ECR-2026-538 (agrégat « PAIEMENT C. PROC » du 06/08, ligne 19166233), ce qui
// laisse une ligne dans `inbox_suggestion_rejets(ecriture_id NOT NULL REFERENCES
// ecritures(id))`. Quand le détail DSP2 de cette ligne est publié, l'agrégat
// devient stale : `planStaleLineDrafts` le juge NU (le garde-fou ne regarde que
// justificatifs / depots_justificatifs / remboursements) et le scan tente de le
// supprimer → violation de FK → exception. Comme le `try` englobe la boucle
// ENTIÈRE, les 20 lignes bancaires suivantes n'étaient plus jamais traitées :
// plus aucune ligne agrégée n'était éclatée en sous-lignes, silencieusement
// (runSyncCycle ignore `erreur`, le sync_run reste « ok », new_drafts = 0).
//
// Les autres fixtures de drafts tournent en `foreign_keys = OFF` : cet angle
// mort est précisément ce qui a laissé passer le bug, d'où FK ON ici.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

const bankLinesRef: { value: unknown[] } = { value: [] };
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async () => ({ ecrituresBancaires: bankLinesRef.value, ecrituresComptables: [] }),
  listRapprochementBancaire: vi.fn(),
  createEcriture: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
let idCounter = 0;
vi.mock('../../ids', () => ({
  nextId: async (prefix: string) => `${prefix}-NEW-${++idCounter}`,
  currentTimestamp: () => '2026-09-05T09:00:00Z',
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
    created_at TEXT NOT NULL DEFAULT '2026-08-19T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-08-19T00:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT REFERENCES ecritures(id));
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT);
  CREATE TABLE inbox_suggestion_rejets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    ecriture_id TEXT NOT NULL REFERENCES ecritures(id),
    target_kind TEXT NOT NULL DEFAULT 'depot',
    target_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT '2026-08-20T00:00:00Z'
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  // La prod (Turso) applique les FK : c'est ce qui fait échouer le DELETE.
  await client.execute('PRAGMA foreign_keys = ON');
  return db;
}

// Ligne « PAIEMENT C. PROC » dont le détail DSP2 vient d'être publié.
function ligneAvecDetail(id: number, jour: string) {
  return {
    id,
    dateOperation: `2026-08-${jour}`,
    montantCentimes: -18287,
    intitule: 'PAIEMENT C. PROC PBWD76QHY',
    sousLignes: [
      { montantCentimes: -6150, commercant: 'INTERBRIORD' },
      { montantCentimes: -12137, commercant: 'PROXIURGBEYNOS' },
    ],
  };
}

// Agrégat NU créé avant publication du détail (pas d'imputation, pas de pièce).
async function insertAgregat(db: DbWrapper, id: string, ligneId: number, jour: string) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine,
         amount_cents, type, status, justif_attendu, ligne_bancaire_id, ligne_bancaire_sous_index)
       VALUES (?, 'val-de-saone', ?, 'PAIEMENT C. PROC PBWD76QHY', 'PAIEMENT C. PROC PBWD76QHY',
         18287, 'depense', 'draft', 1, ?, NULL)`,
    )
    .run(id, `2026-08-${jour}`, ligneId);
}

const souslignes = (db: DbWrapper, ligneId: number) =>
  db
    .prepare(
      `SELECT id FROM ecritures WHERE ligne_bancaire_id = ? AND ligne_bancaire_sous_index IS NOT NULL`,
    )
    .all<{ id: string }>(ligneId);

describe('scanDraftsFromComptaweb — suppression d’un agrégat stale sous contrainte FK', () => {
  let db: DbWrapper;

  beforeEach(async () => {
    idCounter = 0;
    db = await setupDb();
  });

  it('éclate la ligne malgré un rejet inbox qui pointe sur l’agrégat', async () => {
    bankLinesRef.value = [ligneAvecDetail(19166233, '06')];
    await insertAgregat(db, 'ECR-2026-538', 19166233, '06');
    await db
      .prepare(
        `INSERT INTO inbox_suggestion_rejets (group_id, ecriture_id, target_kind, target_id)
         VALUES ('val-de-saone', 'ECR-2026-538', 'depot', 'DEP-2026-12')`,
      )
      .run();

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    expect(res.erreur).toBeUndefined();
    expect(res.crees).toBe(2);
    expect(await souslignes(db, 19166233)).toHaveLength(2);
    const agregat = await db
      .prepare(`SELECT id FROM ecritures WHERE id = 'ECR-2026-538'`)
      .get<{ id: string }>();
    expect(agregat).toBeUndefined();
    // Le rejet portait sur une paire qui n'existe plus : il part avec l'agrégat.
    const rejets = await db.prepare('SELECT id FROM inbox_suggestion_rejets').all();
    expect(rejets).toHaveLength(0);
  });

  it('continue les lignes suivantes quand une FK non nettoyable bloque une suppression', async () => {
    bankLinesRef.value = [ligneAvecDetail(19166233, '06'), ligneAvecDetail(19167127, '07')];
    await insertAgregat(db, 'ECR-2026-538', 19166233, '06');
    await insertAgregat(db, 'ECR-2026-539', 19167127, '07');
    // Lien métier réel (dépôt d'espèces rapproché) : on ne le sacrifie pas.
    await db
      .prepare(`INSERT INTO depots_especes (id, ecriture_id) VALUES ('DPE-1', 'ECR-2026-538')`)
      .run();

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    // La ligne bloquée est signalée, mais la suivante est traitée normalement.
    expect(res.lignes_en_erreur).toBe(1);
    expect(await souslignes(db, 19167127)).toHaveLength(2);
    const agregatBloque = await db
      .prepare(`SELECT id FROM ecritures WHERE id = 'ECR-2026-538'`)
      .get<{ id: string }>();
    expect(agregatBloque?.id).toBe('ECR-2026-538');
  });
});
