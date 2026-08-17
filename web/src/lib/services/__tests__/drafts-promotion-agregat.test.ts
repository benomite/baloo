// Promotion d'un draft « ligne entière » DÉJÀ justifié en sous-ligne DSP2.
//
// Cas terrain 2026-08-17 : la banque publie le détail DSP2 d'un « PAIEMENT
// C. PROC » à la clôture du relevé mensuel. Au premier scrape la ligne n'a pas
// de sous-ligne → un draft agrégé est créé, puis le trésorier l'impute et y
// rattache ses justifs. Des semaines plus tard le détail apparaît → un draft
// par sous-ligne s'ajoute, et l'agrégat survit en doublon (la garde
// `hasAttachment` interdit de le supprimer) : ECR-2026-472 (agrégat, 2 justifs
// + 1 dépôt) face à ECR-2026-524 (sous-ligne nue), ligne bancaire 19130340.
//
// Quand le détail ne compte qu'UNE sous-ligne, l'identité est forcée :
// l'agrégat prend le sous-index au lieu d'être doublonné — il garde son id,
// donc ses justifs, son dépôt rattaché et son imputation.

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
  currentTimestamp: () => '2026-08-17T09:00:00Z',
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
    created_at TEXT NOT NULL DEFAULT '2026-07-10T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-07-10T00:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT);
`;

const LIGNE = 19130340;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return db;
}

/** Ligne carte dont le détail DSP2 vient d'apparaître, avec `n` sous-lignes. */
function ligneAvecDetail(sousLignes: Array<{ montantCentimes: number; commercant: string }>) {
  return {
    id: LIGNE,
    dateOperation: '2026-07-09',
    montantCentimes: -24635,
    intitule: 'PAIEMENT C. PROC PKJ39351K',
    sousLignes,
  };
}

/** L'agrégat tel que créé au premier scrape puis enrichi par le trésorier. */
async function insertAgregatJustifie(
  db: DbWrapper,
  over: { description?: string; notes?: string } = {},
) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine, amount_cents,
         type, category_id, unite_id, status, justif_attendu, ligne_bancaire_id, ligne_bancaire_sous_index, notes)
       VALUES ('ECR-AGREGAT', 'g', '2026-07-09', ?, 'PAIEMENT C. PROC PKJ39351K', 24635,
         'depense', 'cat-intendance', 'u-lj', 'draft', 1, ?, NULL, ?)`,
    )
    .run(
      over.description ?? 'Camp Orange - Ticket milieux course',
      LIGNE,
      over.notes ?? `Draft généré depuis ligne bancaire ${LIGNE}.`,
    );
  await db.prepare("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('JUS-1', 'ecriture', 'ECR-AGREGAT')").run();
  await db.prepare("INSERT INTO depots_justificatifs (id, ecriture_id) VALUES ('DEP-1', 'ECR-AGREGAT')").run();
}

/** Le draft nu de la sous-ligne, créé par le scrape qui a vu le détail. */
async function insertSousLigneNue(db: DbWrapper) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine, amount_cents,
         type, status, justif_attendu, ligne_bancaire_id, ligne_bancaire_sous_index, notes)
       VALUES ('ECR-SOUSLIGNE', 'g', '2026-07-09', 'INTERMARCHE', 'INTERMARCHE', 24635,
         'depense', 'draft', 1, ?, 0, ?)`,
    )
    .run(LIGNE, `Draft généré depuis ligne bancaire ${LIGNE} sous-ligne 0 (intitulé parent: PAIEMENT C. PROC PKJ39351K).`);
}

async function readEcriture(db: DbWrapper, id: string) {
  return db
    .prepare(
      `SELECT id, description, libelle_origine, ligne_bancaire_sous_index AS sousIndex,
              category_id, unite_id, amount_cents, notes FROM ecritures WHERE id = ?`,
    )
    .get<{
      id: string; description: string; libelle_origine: string; sousIndex: number | null;
      category_id: string | null; unite_id: string | null; amount_cents: number; notes: string;
    }>(id);
}

async function countEcritures(db: DbWrapper): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
  return r?.n ?? 0;
}

describe('scanDraftsFromComptaweb — agrégat justifié supplanté par le détail DSP2', () => {
  beforeEach(() => { idCounter = 0; bankLinesRef.value = []; });

  it('promeut l’agrégat en sous-ligne unique en gardant justifs, dépôt et imputation', async () => {
    const db = await setupDb();
    await insertAgregatJustifie(db);
    bankLinesRef.value = [ligneAvecDetail([{ montantCentimes: -24635, commercant: 'INTERMARCHE' }])];

    const res = await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    expect(res.promus).toBe(1);
    expect(res.crees).toBe(0); // surtout pas un nouveau draft à côté
    expect(await countEcritures(db)).toBe(1);

    const e = await readEcriture(db, 'ECR-AGREGAT');
    expect(e?.sousIndex).toBe(0);
    expect(e?.libelle_origine).toBe('INTERMARCHE');
    expect(e?.description).toBe('Camp Orange - Ticket milieux course'); // titre parlant conservé
    expect(e?.category_id).toBe('cat-intendance');
    expect(e?.unite_id).toBe('u-lj');
    expect(e?.amount_cents).toBe(24635);
  });

  it('supprime le doublon nu déjà créé pour cette sous-ligne', async () => {
    const db = await setupDb();
    await insertAgregatJustifie(db);
    await insertSousLigneNue(db);
    bankLinesRef.value = [ligneAvecDetail([{ montantCentimes: -24635, commercant: 'INTERMARCHE' }])];

    const res = await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    expect(res.promus).toBe(1);
    expect(res.supprimes).toBe(1);
    expect(await countEcritures(db)).toBe(1);
    expect(await readEcriture(db, 'ECR-SOUSLIGNE')).toBeUndefined();
    expect((await readEcriture(db, 'ECR-AGREGAT'))?.sousIndex).toBe(0);
  });

  it('est idempotent : un second scan ne recrée pas le doublon', async () => {
    const db = await setupDb();
    await insertAgregatJustifie(db);
    bankLinesRef.value = [ligneAvecDetail([{ montantCentimes: -24635, commercant: 'INTERMARCHE' }])];

    await scanDraftsFromComptaweb({ groupId: 'g' }, db);
    const res2 = await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    expect(res2.promus).toBe(0);
    expect(res2.crees).toBe(0);
    expect(res2.existants).toBe(1);
    expect(await countEcritures(db)).toBe(1);
  });

  it('fait suivre le libellé brut quand le trésorier n’a jamais renommé', async () => {
    const db = await setupDb();
    await insertAgregatJustifie(db, { description: 'PAIEMENT C. PROC PKJ39351K' });
    bankLinesRef.value = [ligneAvecDetail([{ montantCentimes: -24635, commercant: 'INTERMARCHE' }])];

    await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    const e = await readEcriture(db, 'ECR-AGREGAT');
    // description == libelle_origine → le nudge « titre à renommer » survit,
    // mais sur le libellé du commerçant, pas sur l'intitulé agrégé périmé.
    expect(e?.description).toBe('INTERMARCHE');
    expect(e?.libelle_origine).toBe('INTERMARCHE');
  });

  it('n’écrase pas une note saisie par le trésorier', async () => {
    const db = await setupDb();
    await insertAgregatJustifie(db, { notes: 'Avance remboursée par Sarah le 12/07' });
    bankLinesRef.value = [ligneAvecDetail([{ montantCentimes: -24635, commercant: 'INTERMARCHE' }])];

    await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    expect((await readEcriture(db, 'ECR-AGREGAT'))?.notes).toBe('Avance remboursée par Sarah le 12/07');
  });

  it('signale sans rien toucher quand le détail compte plusieurs sous-lignes', async () => {
    const db = await setupDb();
    await insertAgregatJustifie(db);
    bankLinesRef.value = [ligneAvecDetail([
      { montantCentimes: -20000, commercant: 'INTERMARCHE' },
      { montantCentimes: -4635, commercant: 'BOULANGERIE' },
    ])];

    const res = await scanDraftsFromComptaweb({ groupId: 'g' }, db);

    expect(res.promus).toBe(0);
    expect(res.supplantes).toEqual(['ECR-AGREGAT']);
    expect(res.crees).toBe(2); // les deux sous-lignes sont bien créées
    const e = await readEcriture(db, 'ECR-AGREGAT');
    expect(e?.sousIndex).toBeNull(); // agrégat intact, à reventiler par le trésorier
    expect(e?.category_id).toBe('cat-intendance');
  });
});
