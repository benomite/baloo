// Fin d'exercice : l'écriture du virement d'un remboursement a été créée AVANT
// la remontée de sa ligne bancaire (payé fin août, débité en septembre). Quand
// la ligne arrive — pas encore rapprochée dans CW — le scan ne doit pas en
// faire un draft en doublon de l'écriture déjà saisie.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

const bankLinesRef: { value: unknown[] } = { value: [] };
const cwComptablesRef: { value: unknown[] } = { value: [] };
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async () => ({
    ecrituresBancaires: bankLinesRef.value,
    ecrituresComptables: cwComptablesRef.value,
  }),
  listRapprochementBancaire: vi.fn(),
  createEcriture: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
let idCounter = 0;
vi.mock('../../ids', () => ({
  nextId: async (prefix: string) => `${prefix}-NEW-${++idCounter}`,
  currentTimestamp: () => '2026-09-05T09:00:00Z',
}));

import { scanDraftsFromComptaweb, findEcritureAnticipee } from '../drafts';

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
    category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER, carte_id TEXT,
    libelle_origine TEXT, ventilation_group_id TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-08-28T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-08-28T00:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT, date_paiement TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT);
`;

const G = 'val-de-saone';

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return db;
}

// Écriture du virement de RBT-1 (84,50 €, 28/08), liée à la demande.
async function insertAnticipee(
  db: DbWrapper,
  opts: {
    id?: string; status?: string; cwId?: number | null; ligne?: number | null; date?: string;
    datePaiement?: string | null;
  } = {},
) {
  const id = opts.id ?? 'ECR-ANT';
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
         status, comptaweb_ecriture_id, ligne_bancaire_id)
       VALUES (?, ?, ?, 'Remboursement Florence Martin', 8450, 'depense', ?, ?, ?)`,
    )
    .run(id, G, opts.date ?? '2026-08-28', opts.status ?? 'draft', opts.cwId ?? null, opts.ligne ?? null);
  await db
    .prepare(`INSERT INTO remboursements (id, ecriture_id, date_paiement) VALUES (?, ?, ?)`)
    .run(`RBT-${id}`, id, opts.datePaiement ?? null);
}

function virement(id: number, date = '2026-09-02', montant = -8450) {
  return { id, dateOperation: date, montantCentimes: montant, intitule: 'VIR SEPA MARTIN FLORENCE', sousLignes: [] };
}

async function draftsDeLigne(db: DbWrapper, ligne: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM ecritures WHERE ligne_bancaire_id = ?').get<{ n: number }>(ligne);
  return r?.n ?? 0;
}

describe('scanDraftsFromComptaweb — écriture de remboursement anticipée', () => {
  beforeEach(() => { idCounter = 0; bankLinesRef.value = []; cwComptablesRef.value = []; });

  it('brouillon local (pas encore envoyé à CW) : la ligne bancaire ne crée pas de doublon', async () => {
    const db = await setupDb();
    await insertAnticipee(db);
    bankLinesRef.value = [virement(19300001)];

    const res = await scanDraftsFromComptaweb({ groupId: G }, db);

    expect(res.anticipes).toBe(1);
    expect(res.crees).toBe(0);
    expect(await draftsDeLigne(db, 19300001)).toBe(0);
  });

  it('écriture datée de la dernière dépense (juin) : la fenêtre part du virement (septembre)', async () => {
    const db = await setupDb();
    // 20/06 → 03/09 = 75 j : hors fenêtre si on partait de la date de l'écriture.
    await insertAnticipee(db, { date: '2026-06-20', datePaiement: '2026-09-01' });
    bankLinesRef.value = [virement(19300001, '2026-09-03')];

    const res = await scanDraftsFromComptaweb({ groupId: G }, db);

    expect(res.anticipes).toBe(1);
    expect(res.crees).toBe(0);
  });

  it('écriture déjà dans CW mais non rapprochée : pas de doublon', async () => {
    const db = await setupDb();
    await insertAnticipee(db, { status: 'mirror', cwId: 2500001 });
    cwComptablesRef.value = [{ id: 2500001, montantCentimes: -8450 }];
    bankLinesRef.value = [virement(19300001)];

    const res = await scanDraftsFromComptaweb({ groupId: G }, db);

    expect(res.anticipes).toBe(1);
    expect(res.crees).toBe(0);
  });

  it('écriture CW déjà rapprochée : ne peut plus absorber une nouvelle ligne au même montant', async () => {
    const db = await setupDb();
    await insertAnticipee(db, { status: 'mirror', cwId: 2500001 });
    cwComptablesRef.value = []; // plus parmi les non rapprochées
    bankLinesRef.value = [virement(19300001)];

    const res = await scanDraftsFromComptaweb({ groupId: G }, db);

    expect(res.anticipes).toBe(0);
    expect(res.crees).toBe(1);
  });

  it('mirror sans id CW (import historique) : jamais candidate', async () => {
    const db = await setupDb();
    await insertAnticipee(db, { status: 'mirror', cwId: null });
    bankLinesRef.value = [virement(19300001)];

    const res = await scanDraftsFromComptaweb({ groupId: G }, db);

    expect(res.crees).toBe(1);
  });

  it("une écriture déjà née d'une ligne bancaire n'est pas une anticipée", async () => {
    const db = await setupDb();
    await insertAnticipee(db, { ligne: 19299999 });
    bankLinesRef.value = [virement(19300001)];

    const res = await scanDraftsFromComptaweb({ groupId: G }, db);

    expect(res.crees).toBe(1);
  });

  it("une écriture anticipée n'absorbe qu'UNE ligne bancaire", async () => {
    const db = await setupDb();
    await insertAnticipee(db);
    bankLinesRef.value = [virement(19300001), virement(19300002, '2026-09-03')];

    const res = await scanDraftsFromComptaweb({ groupId: G }, db);

    expect(res.anticipes).toBe(1);
    expect(res.crees).toBe(1);
  });

  it('une recette au même montant reste un draft', async () => {
    const db = await setupDb();
    await insertAnticipee(db);
    bankLinesRef.value = [virement(19300001, '2026-09-02', 8450)];

    const res = await scanDraftsFromComptaweb({ groupId: G }, db);

    expect(res.anticipes).toBe(0);
    expect(res.crees).toBe(1);
  });
});

describe('findEcritureAnticipee', () => {
  const pool = [
    { id: 'A', date: '2026-08-28', totalCents: 8450 },
    { id: 'B', date: '2026-06-01', totalCents: 8450 },
  ];

  it('matche le montant exact dans la fenêtre, la plus proche en date', () => {
    expect(findEcritureAnticipee(pool, '2026-09-02', 8450, new Set())).toBe('A');
  });

  it('hors fenêtre (débit > 60 j après le virement) : pas de match', () => {
    expect(findEcritureAnticipee([pool[1]], '2026-09-02', 8450, new Set())).toBeNull();
  });

  it('débit antérieur de plus de 7 j au virement : pas de match', () => {
    expect(findEcritureAnticipee([pool[0]], '2026-08-15', 8450, new Set())).toBeNull();
  });

  it('montant différent : pas de match', () => {
    expect(findEcritureAnticipee(pool, '2026-09-02', 8451, new Set())).toBeNull();
  });

  it('ignore les écritures déjà consommées', () => {
    expect(findEcritureAnticipee([pool[0]], '2026-09-02', 8450, new Set(['A']))).toBeNull();
  });
});
