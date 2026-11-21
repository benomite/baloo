// Transfert interne (#51) — server actions du panneau d'écriture : qualifier
// un brouillon, voir / lier / créer l'opération de caisse correspondante.
// Services réels sur une BDD en mémoire ; seuls contexte et cache Next sont
// doublés.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
const revalidatePath = vi.fn();
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../context', () => ({ getCurrentContext: async () => ({ groupId: 'g1', scopeUniteIds: [] }) }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

import {
  qualifierEcriture,
  fetchCaissePourTransfert,
  lierOperationCaisse,
  creerOperationCaisseDepuisEcriture,
} from '../transfert-interne';

beforeEach(async () => {
  revalidatePath.mockClear();
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
    INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, mode_transfert, ligne_bancaire_id)
    VALUES ('D1', 'g1', '2026-10-03', 'Dépôt camp', 25000, 'transfert_interne', 'depot_especes', 1),
           ('R1', 'g1', '2026-10-05', 'Retrait sortie', 8000, 'transfert_interne', 'retrait_especes', 2),
           ('T1', 'g1', '2026-10-06', 'Transfert', 500, 'transfert_interne', 'transfert_especes', 3),
           ('V1', 'g1', '2026-10-07', 'VERSEMENT', 1200, 'recette', NULL, 4);
    INSERT INTO depots_especes (id, group_id, date_depot, total_amount_cents) VALUES ('DES-OLD', 'g1', '2026-10-02', 25000);
    INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, type)
    VALUES ('CAI-R', 'g1', '2026-10-05', 'Retrait', 8000, 'retrait');
  `);
});

const ligne = (id: string) =>
  testDb.prepare('SELECT type, mode_transfert FROM ecritures WHERE id = ?').get(id);

describe('qualifierEcriture', () => {
  it('passe un brouillon en transfert interne et rafraîchit les pages', async () => {
    expect(await qualifierEcriture('V1', 'retrait_especes')).toEqual({ ok: true });
    expect(await ligne('V1')).toEqual({ type: 'transfert_interne', mode_transfert: 'retrait_especes' });
    expect(revalidatePath).toHaveBeenCalledWith('/caisse');
  });

  it('le repasse en recette', async () => {
    expect(await qualifierEcriture('D1', 'recette')).toEqual({ ok: true });
    expect(await ligne('D1')).toEqual({ type: 'recette', mode_transfert: null });
  });

  it('nature inconnue : message, rien n’est écrit', async () => {
    const r = await qualifierEcriture('V1', 'virement');
    expect(r).toEqual({ ok: false, message: 'Nature d\'écriture inconnue : virement.' });
    expect(await ligne('V1')).toEqual({ type: 'recette', mode_transfert: null });
  });

  it('écriture inconnue : message', async () => {
    expect(await qualifierEcriture('NOPE', 'depense')).toEqual({ ok: false, message: 'Écriture NOPE introuvable.' });
  });
});

describe('fetchCaissePourTransfert', () => {
  it('dépôt : dépôts en attente, pas de retrait', async () => {
    const c = await fetchCaissePourTransfert('D1');
    expect(c?.liee).toBeNull();
    expect(c?.depotsEnAttente.map((d) => d.id)).toEqual(['DES-OLD']);
    expect(c?.retraitsEnAttente).toEqual([]);
  });

  it('retrait : retraits en attente, pas de dépôt', async () => {
    const c = await fetchCaissePourTransfert('R1');
    expect(c?.depotsEnAttente).toEqual([]);
    expect(c?.retraitsEnAttente.map((m) => m.id)).toEqual(['CAI-R']);
  });

  it('transfert d’espèces : rien à lier', async () => {
    expect(await fetchCaissePourTransfert('T1')).toEqual({ liee: null, depotsEnAttente: [], retraitsEnAttente: [] });
  });

  it('écriture inconnue : null', async () => {
    expect(await fetchCaissePourTransfert('NOPE')).toBeNull();
  });
});

describe('lierOperationCaisse', () => {
  it('dépôt : lie le dépôt existant', async () => {
    expect(await lierOperationCaisse('D1', 'DES-OLD')).toEqual({ ok: true });
    const c = await fetchCaissePourTransfert('D1');
    expect(c?.liee).toMatchObject({ kind: 'depot', depot: { id: 'DES-OLD', ecriture_id: 'D1' } });
  });

  it('retrait : lie le retrait existant', async () => {
    expect(await lierOperationCaisse('R1', 'CAI-R')).toEqual({ ok: true });
    const c = await fetchCaissePourTransfert('R1');
    expect(c?.liee).toMatchObject({ kind: 'retrait', mouvement: { id: 'CAI-R', status: 'rapproche' } });
  });

  it('transfert d’espèces : refusé', async () => {
    expect(await lierOperationCaisse('T1', 'CAI-R')).toMatchObject({ ok: false });
  });

  it('opération inconnue : message du service', async () => {
    expect(await lierOperationCaisse('D1', 'DES-NOPE')).toEqual({ ok: false, message: 'Dépôt espèces DES-NOPE introuvable.' });
  });

  it('écriture inconnue : message', async () => {
    expect(await lierOperationCaisse('NOPE', 'DES-OLD')).toEqual({ ok: false, message: 'Écriture NOPE introuvable.' });
  });
});

describe('creerOperationCaisseDepuisEcriture', () => {
  it('dépôt : même date, même montant, même titre, déjà lié', async () => {
    expect(await creerOperationCaisseDepuisEcriture('D1')).toEqual({ ok: true });
    const c = await fetchCaissePourTransfert('D1');
    expect(c?.liee).toMatchObject({ kind: 'depot', depot: { date_depot: '2026-10-03', total_amount_cents: 25000, ecriture_id: 'D1' } });
    const m = await testDb.prepare("SELECT description, amount_cents, status FROM mouvements_caisse WHERE type = 'depot'").get();
    expect(m).toEqual({ description: 'Dépôt camp', amount_cents: -25000, status: 'rapproche' });
  });

  it('retrait : entrée en caisse, même date et montant, déjà lié', async () => {
    expect(await creerOperationCaisseDepuisEcriture('R1')).toEqual({ ok: true });
    const c = await fetchCaissePourTransfert('R1');
    expect(c?.liee).toMatchObject({
      kind: 'retrait',
      mouvement: { date_mouvement: '2026-10-05', amount_cents: 8000, description: 'Retrait sortie' },
    });
  });

  it('transfert d’espèces : refusé', async () => {
    expect(await creerOperationCaisseDepuisEcriture('T1')).toMatchObject({ ok: false });
  });

  it('écriture inconnue : message', async () => {
    expect(await creerOperationCaisseDepuisEcriture('NOPE')).toEqual({ ok: false, message: 'Écriture NOPE introuvable.' });
  });

  it('erreur du service : rendue en message', async () => {
    await testDb.prepare("UPDATE ecritures SET amount_cents = 0 WHERE id = 'D1'").run();
    expect(await creerOperationCaisseDepuisEcriture('D1')).toEqual({
      ok: false,
      message: 'Le montant du dépôt doit être strictement positif.',
    });
  });
});
