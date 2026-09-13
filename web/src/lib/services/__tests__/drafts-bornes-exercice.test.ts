// Bornes d'exercice sur le PÉRIMÈTRE des brouillons d'une ligne bancaire
// (ADR-039, constat de relecture 2026-09-13).
//
// Les ids de lignes bancaires sont RECYCLÉS par Comptaweb entre transactions.
// Depuis que le scan tourne une fois par exercice, un brouillon d'août peut se
// retrouver confronté à l'ensemble canonique d'une ligne de SEPTEMBRE portant
// le même id : son `sous_index` (null) n'y figure pas, et la garde de
// `planStaleLineDrafts` ne protège l'imputation que des brouillons de
// SOUS-LIGNE — un brouillon « ligne entière » imputé et sans pièce part donc en
// DELETE, avec son imputation, ses notes et son titre renommé.
//
// Le correctif est le périmètre d'entrée, pas la garde : `findLineDrafts` ne
// doit voir que les brouillons de l'exercice scanné.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

const dataRef: { value: unknown } = { value: { ecrituresBancaires: [], ecrituresComptables: [] } };
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async () => dataRef.value,
  listRapprochementBancaire: vi.fn(),
  createEcriture: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
let compteurId = 0;
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-NEW-${++compteurId}`,
  currentTimestamp: () => '2026-09-13T08:00:00Z',
}));

import { scanDraftsFromComptaweb } from '../drafts';

const DDL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
    category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER, carte_id TEXT,
    libelle_origine TEXT, ventilation_group_id TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-08-24T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-08-24T00:00:00Z'
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT, date_paiement TEXT);
  CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, comptaweb_id INTEGER);
  CREATE TABLE cartes (id TEXT PRIMARY KEY, group_id TEXT, code_externe TEXT, statut TEXT);
`;

/** L'id 19200001 est RECYCLÉ : il porte en septembre une autre transaction. */
const LIGNE_ID = 19200001;

const EXERCICE_2627 = { debut: '2026-09-01', fin: '2027-08-31' };

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(DDL);

  // Le brouillon d'AOÛT : « ligne entière » (sous_index null), IMPUTÉ, sans
  // aucune pièce attachée, renommé par le trésorier. C'est exactement le profil
  // que la garde de `planStaleLineDrafts` ne protège pas.
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine,
         amount_cents, type, status, category_id, ligne_bancaire_id, ligne_bancaire_sous_index,
         comptaweb_ecriture_id, notes)
       VALUES ('ECR-AOUT', 'g1', '2026-08-24', 'Intendance camp Piok', 'CARTE 24/08 METRO',
         9900, 'depense', 'draft', 'cat-alimentation', ?, NULL, NULL, 'Note du trésorier')`,
    )
    .run(LIGNE_ID);

  // La ligne bancaire de SEPTEMBRE sous le même id, avec son détail DSP2.
  dataRef.value = {
    ecrituresBancaires: [
      {
        id: LIGNE_ID,
        dateOperation: '2026-09-05',
        montantCentimes: -12000,
        intitule: 'PAIEMENT C. PROC 05/09',
        sousLignes: [
          { commercant: 'BOULANGERIE', montantCentimes: -4000 },
          { commercant: 'PAPETERIE', montantCentimes: -4000 },
          { commercant: 'QUINCAILLERIE', montantCentimes: -4000 },
        ],
      },
    ],
    ecrituresComptables: [],
  };
  return db;
}

async function aoutExiste(db: DbWrapper): Promise<boolean> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM ecritures WHERE id = 'ECR-AOUT'")
    .get<{ n: number }>();
  return (r?.n ?? 0) === 1;
}

describe('scanDraftsFromComptaweb — périmètre borné à l’exercice scanné', () => {
  beforeEach(() => vi.clearAllMocks());

  it('un brouillon d’août survit au scan de septembre sur un id de ligne recyclé', async () => {
    const db = await setup();

    const res = await scanDraftsFromComptaweb({ groupId: 'g1' }, db, { exercice: EXERCICE_2627 });

    expect(await aoutExiste(db)).toBe(true); // imputation, notes et titre préservés
    expect(res.supprimes).toBe(0);
    expect(res.crees).toBe(3); // les 3 sous-lignes de septembre sont bien créées

    const aout = await db
      .prepare("SELECT category_id, description, notes FROM ecritures WHERE id = 'ECR-AOUT'")
      .get<{ category_id: string; description: string; notes: string }>();
    expect(aout?.category_id).toBe('cat-alimentation');
    expect(aout?.description).toBe('Intendance camp Piok');
    expect(aout?.notes).toBe('Note du trésorier');
  });

  it('témoin : SANS bornes, ce même brouillon d’août est détruit', async () => {
    // Documente le défaut que la borne corrige — et prouve que le test ci-dessus
    // mord vraiment. Sans bornes, le comportement historique est conservé :
    // c'est ce qui rend l'ajout rétrocompatible pour les appels manuels.
    const db = await setup();

    const res = await scanDraftsFromComptaweb({ groupId: 'g1' }, db);

    expect(await aoutExiste(db)).toBe(false);
    expect(res.supprimes).toBe(1);
  });
});
