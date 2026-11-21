// Transfert interne (#51) — services : édition du type / mode, champs
// manquants, et lien avec la caisse (dépôt, retrait, opération liée).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { updateEcriture, computeMissingFields } from '../ecritures';
import {
  createDepotEspecesAvecMouvement,
  createRetraitEspecesAvecMouvement,
  attachRetraitEspecesToEcriture,
  listRetraitsEspecesEnAttente,
  getOperationCaisseLiee,
} from '../caisse';
import { listCandidateEcrituresForDepot } from '../depots-especes';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

const g = { groupId: 'g1' };

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
    CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT, name TEXT, couleur TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE activites (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE cartes (id TEXT PRIMARY KEY, porteur TEXT, type TEXT);
    CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
    CREATE TABLE depots_especes (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_depot TEXT NOT NULL,
      total_amount_cents INTEGER NOT NULL, detail_billets TEXT, ecriture_id TEXT,
      airtable_id TEXT, notes TEXT, archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z'
    );
    CREATE TABLE mouvements_caisse (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_mouvement TEXT NOT NULL,
      description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT, numero_piece TEXT,
      status TEXT NOT NULL DEFAULT 'saisi', depot_id TEXT, airtable_id TEXT,
      comptaweb_ecriture_id INTEGER, archived_at TEXT, solde_apres_cents INTEGER,
      unite_id TEXT, activite_id TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z'
    );
    INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, mode_transfert, status, numero_piece)
    VALUES ('E1', 'g1', '2026-10-03', 'VERSEMENT ESPECES', 25000, 'transfert_interne', 'depot_especes', 'draft', NULL),
           ('E2', 'g1', '2026-10-05', 'RETRAIT ESPECES', 8000, 'transfert_interne', 'retrait_especes', 'draft', NULL),
           ('E3', 'g1', '2026-10-05', 'RETRAIT DAB', 8000, 'transfert_interne', 'retrait_especes', 'draft', 'P-9'),
           ('M1', 'g1', '2026-10-01', 'Déjà dans CW', 100, 'transfert_interne', 'depot_especes', 'mirror', NULL),
           ('R1', 'g1', '2026-10-03', 'Cotisation', 25000, 'recette', NULL, 'draft', NULL);
  `);
});

async function ligne(id: string) {
  return testDb.prepare('SELECT type, mode_transfert, numero_piece FROM ecritures WHERE id = ?').get(id);
}

describe('updateEcriture — type et mode de transfert', () => {
  it('redevenir recette vide le mode', async () => {
    await updateEcriture(g, 'E1', { type: 'recette' });
    expect(await ligne('E1')).toMatchObject({ type: 'recette', mode_transfert: null });
  });

  it('changer seulement le mode d’un transfert', async () => {
    await updateEcriture(g, 'E1', { mode_transfert: 'transfert_especes' });
    expect(await ligne('E1')).toMatchObject({ type: 'transfert_interne', mode_transfert: 'transfert_especes' });
  });

  it('un mode sur une recette est ignoré', async () => {
    await updateEcriture(g, 'R1', { mode_transfert: 'depot_especes' });
    expect(await ligne('R1')).toMatchObject({ type: 'recette', mode_transfert: null });
  });

  it('mode inconnu : erreur, rien n’est écrit', async () => {
    await expect(updateEcriture(g, 'E1', { mode_transfert: 'virement' as never })).rejects.toThrow(/invalide/);
    expect(await ligne('E1')).toMatchObject({ mode_transfert: 'depot_especes' });
  });

  it('mode vidé explicitement (null) sur un transfert', async () => {
    await updateEcriture(g, 'E1', { mode_transfert: null });
    expect(await ligne('E1')).toMatchObject({ type: 'transfert_interne', mode_transfert: null });
  });

  it('écriture déjà dans Comptaweb : ni type ni mode ne bougent', async () => {
    await updateEcriture(g, 'M1', { type: 'recette', mode_transfert: 'retrait_especes' });
    expect(await ligne('M1')).toMatchObject({ type: 'transfert_interne', mode_transfert: 'depot_especes' });
  });
});

describe('computeMissingFields — transfert interne', () => {
  const base = {
    status: 'draft', category_id: null, activite_id: null, unite_id: null, mode_paiement_id: null,
    type: 'transfert_interne', numero_piece: null, justif_attendu: 1,
  };
  it('sans mode : seul le mode manque', () => {
    expect(computeMissingFields({ ...base, mode_transfert: null })).toEqual(['mode de transfert']);
  });
  it('déjà dans Comptaweb : plus rien à compléter', () => {
    expect(computeMissingFields({ ...base, status: 'mirror', mode_transfert: null })).toEqual([]);
  });
  it('une dépense garde ses champs obligatoires', () => {
    expect(computeMissingFields({ ...base, type: 'depense' })).toEqual(['nature', 'activité', 'unité', 'mode', 'justif']);
  });
});

describe('dépôt d’espèces depuis un brouillon', () => {
  it('écriture inconnue : erreur, aucun dépôt créé', async () => {
    await expect(
      createDepotEspecesAvecMouvement(g, { date_depot: '2026-10-03', total_amount_cents: 25000, ecriture_id: 'NOPE' }),
    ).rejects.toThrow(/introuvable/);
    const n = await testDb.prepare('SELECT COUNT(*) AS n FROM depots_especes').get<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('sans brouillon : dépôt en attente, comme avant', async () => {
    const { depot, mouvement } = await createDepotEspecesAvecMouvement(g, { date_depot: '2026-10-03', total_amount_cents: 25000 });
    expect(depot.ecriture_id).toBeNull();
    expect(mouvement.status).toBe('depose');
  });

  it('candidats : un transfert « retrait » n’est pas proposé pour un dépôt', async () => {
    const c = await listCandidateEcrituresForDepot(g, { amount_cents: 8000, date: '2026-10-05' });
    expect(c.map((e) => e.id)).not.toContain('E2');
    const d = await listCandidateEcrituresForDepot(g, { amount_cents: 25000, date: '2026-10-03' });
    expect(d.map((e) => e.id).sort()).toEqual(['E1', 'R1']);
  });
});

describe('retrait d’espèces', () => {
  it('montant nul : refusé', async () => {
    await expect(createRetraitEspecesAvecMouvement(g, { date_retrait: '2026-10-05', total_amount_cents: 0 }))
      .rejects.toThrow(/strictement positif/);
  });

  it('écriture inconnue : erreur, aucun mouvement créé', async () => {
    await expect(
      createRetraitEspecesAvecMouvement(g, { date_retrait: '2026-10-05', total_amount_cents: 8000, ecriture_id: 'NOPE' }),
    ).rejects.toThrow(/introuvable/);
    const n = await testDb.prepare('SELECT COUNT(*) AS n FROM mouvements_caisse').get<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('sans brouillon : saisi, libellé par défaut, en attente de lien', async () => {
    const { mouvement } = await createRetraitEspecesAvecMouvement(g, { date_retrait: '2026-10-05', total_amount_cents: 8000 });
    expect(mouvement).toMatchObject({ type: 'retrait', status: 'saisi', numero_piece: null, description: 'Retrait en banque 2026-10-05' });
    expect((await listRetraitsEspecesEnAttente(g)).map((m) => m.id)).toEqual([mouvement.id]);
  });

  it('lier un retrait existant : n° de pièce partagé, rapproché, visible des deux côtés', async () => {
    const { mouvement } = await createRetraitEspecesAvecMouvement(g, { date_retrait: '2026-10-05', total_amount_cents: 8000 });
    const lie = await attachRetraitEspecesToEcriture(g, mouvement.id, 'E2');
    expect(lie).toMatchObject({ status: 'rapproche', numero_piece: 'E2' });
    expect(await ligne('E2')).toMatchObject({ numero_piece: 'E2' });
    expect(await listRetraitsEspecesEnAttente(g)).toEqual([]);

    const op = await getOperationCaisseLiee(g, 'E2');
    expect(op).toMatchObject({ kind: 'retrait', mouvement: { id: mouvement.id, amount_cents: 8000, date_mouvement: '2026-10-05' } });
  });

  it('le n° de pièce déjà saisi sur l’écriture est repris', async () => {
    const { mouvement } = await createRetraitEspecesAvecMouvement(g, { date_retrait: '2026-10-05', total_amount_cents: 8000, ecriture_id: 'E3' });
    expect(mouvement.numero_piece).toBe('P-9');
    expect(await ligne('E3')).toMatchObject({ numero_piece: 'P-9' });
  });

  it('deux n° de pièce différents : refusé', async () => {
    const { mouvement } = await createRetraitEspecesAvecMouvement(g, { date_retrait: '2026-10-05', total_amount_cents: 8000 });
    await testDb.prepare("UPDATE mouvements_caisse SET numero_piece = 'AUTRE' WHERE id = ?").run(mouvement.id);
    await expect(attachRetraitEspecesToEcriture(g, mouvement.id, 'E3')).rejects.toThrow(/même n° de pièce/);
  });

  it('même n° de pièce des deux côtés : accepté', async () => {
    const { mouvement } = await createRetraitEspecesAvecMouvement(g, { date_retrait: '2026-10-05', total_amount_cents: 8000 });
    await testDb.prepare("UPDATE mouvements_caisse SET numero_piece = 'P-9' WHERE id = ?").run(mouvement.id);
    expect((await attachRetraitEspecesToEcriture(g, mouvement.id, 'E3')).status).toBe('rapproche');
  });

  it('n° de pièce du mouvement repris quand l’écriture n’en a pas', async () => {
    const { mouvement } = await createRetraitEspecesAvecMouvement(g, { date_retrait: '2026-10-05', total_amount_cents: 8000 });
    await testDb.prepare("UPDATE mouvements_caisse SET numero_piece = 'RET-1' WHERE id = ?").run(mouvement.id);
    await attachRetraitEspecesToEcriture(g, mouvement.id, 'E2');
    expect(await ligne('E2')).toMatchObject({ numero_piece: 'RET-1' });
  });

  it('un mouvement qui n’est pas un retrait ne se lie pas', async () => {
    await createDepotEspecesAvecMouvement(g, { date_depot: '2026-10-03', total_amount_cents: 25000 });
    const dep = await testDb.prepare("SELECT id FROM mouvements_caisse WHERE type = 'depot'").get<{ id: string }>();
    await expect(attachRetraitEspecesToEcriture(g, dep!.id, 'E2')).rejects.toThrow(/introuvable/);
  });
});

describe('getOperationCaisseLiee', () => {
  it('dépôt lié au brouillon', async () => {
    const { depot } = await createDepotEspecesAvecMouvement(g, { date_depot: '2026-10-03', total_amount_cents: 25000, ecriture_id: 'E1' });
    expect(await getOperationCaisseLiee(g, 'E1')).toMatchObject({ kind: 'depot', depot: { id: depot.id, ecriture_id: 'E1' } });
  });

  it('rien de lié : null (un retrait non rapproché ne compte pas)', async () => {
    await createRetraitEspecesAvecMouvement(g, { date_retrait: '2026-10-05', total_amount_cents: 8000 });
    await testDb.prepare("UPDATE ecritures SET numero_piece = 'X' WHERE id = 'E2'").run();
    await testDb.prepare("UPDATE mouvements_caisse SET numero_piece = 'X'").run();
    expect(await getOperationCaisseLiee(g, 'E2')).toBeNull();
    expect(await getOperationCaisseLiee(g, 'E1')).toBeNull();
  });
});
