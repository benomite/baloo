// Critère 5 (#51) : un transfert interne n'est ni une dépense ni une recette
// dans les totaux de l'exercice (bandeau Écritures et vue d'ensemble). Quand un
// brouillon devient un transfert interne, il sort des recettes et le reste ne
// bouge pas.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { getEcrituresHeaderTotals, getOverview } from '../overview';
import { updateEcriture } from '../ecritures';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

async function totaux() {
  const bandeau = await getEcrituresHeaderTotals({ groupId: 'g1' }, { exercice: '2026-2027' });
  const overview = await getOverview({ groupId: 'g1' }, { exercice: '2026-2027' });
  return {
    entrees: bandeau.entreesExerciceCents,
    sorties: bandeau.sortiesExerciceCents,
    resultat: bandeau.resultatExerciceCents,
    depenses: overview.totalDepenses,
    recettes: overview.totalRecettes,
  };
}

describe('Transfert interne — hors des totaux', () => {
  beforeEach(async () => {
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    testDb = wrapClient(client);
    await testDb.exec(`
      CREATE TABLE ecritures (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, category_id TEXT,
        mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT, carte_id TEXT,
        date_ecriture TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
        type TEXT NOT NULL, mode_transfert TEXT, status TEXT NOT NULL DEFAULT 'draft',
        justif_attendu INTEGER NOT NULL DEFAULT 1, comptaweb_synced INTEGER NOT NULL DEFAULT 0,
        notes TEXT, ligne_bancaire_id INTEGER, ligne_bancaire_sous_index INTEGER,
        libelle_origine TEXT, ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
        created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z',
        updated_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z'
      );
      CREATE TABLE unites (id TEXT PRIMARY KEY, group_id TEXT, code TEXT, name TEXT, couleur TEXT);
      CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, comptaweb_id INTEGER);
      CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE activites (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE cartes (id TEXT PRIMARY KEY, porteur TEXT, type TEXT);
      CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
      CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
      CREATE TABLE comptaweb_imports (id TEXT PRIMARY KEY, group_id TEXT, import_date TEXT, source_file TEXT);
      CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT, ecriture_id TEXT, unite_id TEXT, status TEXT, amount_cents INTEGER);
      CREATE TABLE mouvements_caisse (id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, unite_id TEXT, archived_at TEXT);
      CREATE TABLE budgets (id TEXT PRIMARY KEY, group_id TEXT, saison TEXT);
      CREATE TABLE budget_lignes (id TEXT PRIMARY KEY, budget_id TEXT, unite_id TEXT, type TEXT, amount_cents INTEGER);
      CREATE TABLE repartitions_unites (id TEXT PRIMARY KEY, group_id TEXT, saison TEXT, unite_source_id TEXT, unite_cible_id TEXT, montant_cents INTEGER);
    `);
    await testDb.exec(`
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, category_id)
      VALUES ('D1', 'g1', '2026-10-02', 'Achat', 5000, 'depense', 'mirror', 'c1'),
             ('R1', 'g1', '2026-10-02', 'Cotisations', 12000, 'recette', 'mirror', 'c1'),
             ('T1', 'g1', '2026-10-03', 'VERSEMENT ESPECES', 25000, 'recette', 'draft', NULL);
    `);
  });

  it('qualifier le brouillon en transfert interne le sort des recettes', async () => {
    const avant = await totaux();
    expect(avant.entrees).toBe(37000);

    await updateEcriture({ groupId: 'g1' }, 'T1', {
      type: 'transfert_interne',
      mode_transfert: 'depot_especes',
    } as never);
    const ligne = await testDb
      .prepare('SELECT type, mode_transfert FROM ecritures WHERE id = ?')
      .get<{ type: string; mode_transfert: string | null }>('T1');
    expect(ligne).toEqual({ type: 'transfert_interne', mode_transfert: 'depot_especes' });

    const apres = await totaux();
    expect(apres.entrees).toBe(12000);
    expect(apres.sorties).toBe(5000);
    expect(apres.resultat).toBe(7000);
    expect(apres.recettes).toBe(12000);
    expect(apres.depenses).toBe(5000);
  });
});
