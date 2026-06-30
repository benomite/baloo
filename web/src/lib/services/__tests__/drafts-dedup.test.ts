// Garde anti-doublon du flux bancaire dans scanDraftsFromComptaweb.
//
// Cas terrain 2026-06-30 : une transaction carte (GABORIAUD) remontée DEUX fois
// par la banque (DSP2) pour UN seul paiement réel. CW n'a qu'une écriture
// (reliée à la 1re ligne bancaire). Sans garde, le sync régénère sans cesse un
// draft depuis la 2e ligne, aussitôt re-flaggé `agrege_remplace` → bandeau
// d'arbitrage qui réapparaît à chaque sync, arbitrage qui ne « tient » jamais.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

// Le scrape Comptaweb et l'init env sont court-circuités : seul compte le
// comportement BDD du générateur. withAutoReLogin renvoie directement la liste.
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
  currentTimestamp: () => '2026-06-30T09:00:00Z',
}));

import { scanDraftsFromComptaweb } from '../drafts';

const DESC = 'GABORIAUD SARDA SARDA JULIETTE ZZ1KP4XS2G5XG58BM FR FRANCE';

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL,
    category_id TEXT,
    mode_paiement_id TEXT,
    activite_id TEXT,
    numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    comptaweb_ecriture_id INTEGER,
    carte_id TEXT,
    libelle_origine TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-06-25T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-06-25T00:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT);
`;

async function setupDb(): Promise<{ client: Client; db: DbWrapper }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return { client, db };
}

// Insère le jumeau déjà comptabilisé dans CW (1re ligne bancaire, mirror).
async function insertCwTwin(db: DbWrapper) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
         status, comptaweb_synced, ligne_bancaire_id, comptaweb_ecriture_id)
       VALUES ('ECR-389', 'val-de-saone', '2026-06-23', ?, 4500, 'recette',
         'mirror', 1, 19105752, 2423148)`,
    )
    .run(DESC);
}

function bankLine(id: number, intitule: string) {
  return { id, dateOperation: '2026-06-23', montantCentimes: 4500, intitule, sousLignes: [] };
}

async function countEcritures(db: DbWrapper): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
  return r?.n ?? 0;
}

describe('scanDraftsFromComptaweb — garde anti-doublon bancaire', () => {
  beforeEach(() => { idCounter = 0; bankLinesRef.value = []; });

  it('ne régénère PAS de draft quand le paiement est déjà comptabilisé dans CW (doublon)', async () => {
    const { db } = await setupDb();
    await insertCwTwin(db);
    bankLinesRef.value = [bankLine(19105753, DESC)]; // 2e ligne, même contenu

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    expect(res.doublons).toBe(1);
    expect(res.crees).toBe(0);
    expect(await countEcritures(db)).toBe(1); // toujours la seule écriture CW
  });

  it('crée bien un draft pour une ligne SANS jumeau CW (autre paiement de 45 €)', async () => {
    const { db } = await setupDb();
    await insertCwTwin(db);
    bankLinesRef.value = [bankLine(19105999, 'AUTRE FAMILLE 45 FR FRANCE')];

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    expect(res.crees).toBe(1);
    expect(res.doublons).toBe(0);
    expect(await countEcritures(db)).toBe(2);

    // libelle_origine est figé au libellé brut (= description) à la création.
    const created = await db
      .prepare("SELECT description, libelle_origine FROM ecritures WHERE ligne_bancaire_id = 19105999")
      .get<{ description: string; libelle_origine: string }>();
    expect(created?.libelle_origine).toBe(created?.description);
    expect(created?.libelle_origine).toBe('AUTRE FAMILLE 45 FR FRANCE');
  });

  it('ne déduplique pas une description vide (garde description <> "")', async () => {
    const { db } = await setupDb();
    // Jumeau CW à description vide — ne doit jamais servir de clé de dédup.
    await db
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
           status, comptaweb_synced, ligne_bancaire_id, comptaweb_ecriture_id)
         VALUES ('ECR-EMPTY', 'val-de-saone', '2026-06-23', '', 4500, 'recette',
           'mirror', 1, 19100000, 999)`,
      )
      .run();
    bankLinesRef.value = [bankLine(19105753, '')];

    const res = await scanDraftsFromComptaweb({ groupId: 'val-de-saone' }, db);

    expect(res.doublons).toBe(0);
    expect(res.crees).toBe(1);
  });
});
