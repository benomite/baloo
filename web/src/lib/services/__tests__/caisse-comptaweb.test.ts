// #61 : cycle de vie caisse ↔ Comptaweb — envoi d'un brouillon (validé comme
// un brouillon bancaire), complément, liste des Baloo-only, rapprochement.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import type { ComptawebConfig, CreateEcritureInput } from '../../comptaweb/types';

let db: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => db };
});

import {
  listMouvementsCaisseBalooOnly,
  pushMouvementCaisseToComptaweb,
  rapprocherMouvementCaisseComptaweb,
  type PushMouvementCaisseDeps,
} from '../caisse-comptaweb';
import { persistCaisseSync } from '../caisse-sync';
import { createMouvementCaisse, listMouvementsCaisse } from '../caisse';

const CTX = { groupId: 'g1' };

async function insert(id: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id,
    group_id: 'g1',
    date_mouvement: '2026-10-05',
    description: 'Achat fournitures',
    amount_cents: -800,
    type: 'sortie',
    status: 'draft',
    category_id: 'cat-1',
    unite_id: 'u-1',
    activite_id: 'a-1',
    ...over,
  };
  const cols = Object.keys(row);
  await db
    .prepare(`INSERT INTO mouvements_caisse (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(row));
}

async function lire(id: string) {
  return await db
    .prepare('SELECT * FROM mouvements_caisse WHERE id = ?')
    .get<Record<string, unknown>>(id);
}

function fakeDeps(over: Partial<PushMouvementCaisseDeps> = {}) {
  const envoye: Array<{ input: CreateEcritureInput; dryRun: boolean | undefined; cfg: ComptawebConfig }> = [];
  const deps: PushMouvementCaisseDeps = {
    lookupComptawebId: async (_t, id) => (id ? 7 : null),
    lookupCarte: async () => null,
    resoudreExercice: async () => ({ cwId: 34 }),
    withSession: async (cwId, fn) => fn({ baseUrl: 'https://cw.test', cookie: `c-${cwId}` }),
    resolveCaisseId: async () => 55,
    createEcriture: (async (cfg: ComptawebConfig, input: CreateEcritureInput, opts?: { dryRun?: boolean }) => {
      envoye.push({ input, dryRun: opts?.dryRun, cfg });
      return opts?.dryRun === false ? { dryRun: false, ecritureId: 9001, warnings: [] } : { dryRun: true, warnings: [] };
    }) as PushMouvementCaisseDeps['createEcriture'],
    ...over,
  };
  return { deps, envoye };
}

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  db = wrapClient(client);
  await db.exec(`
    CREATE TABLE mouvements_caisse (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_mouvement TEXT NOT NULL,
      description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT, numero_piece TEXT,
      status TEXT NOT NULL DEFAULT 'saisi', depot_id TEXT, airtable_id TEXT,
      comptaweb_ecriture_id INTEGER, archived_at TEXT, solde_apres_cents INTEGER,
      unite_id TEXT, activite_id TEXT, category_id TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z'
    );
    CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT NOT NULL, comptaweb_id INTEGER);
    CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT);
    CREATE TABLE activites (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO modes_paiement VALUES ('mp-cb', 'Carte bancaire', 3), ('mp-caisse', 'Espèces', 5);
  `);
});

describe('pushMouvementCaisseToComptaweb', () => {
  it('preview par défaut : rien créé, mouvement inchangé', async () => {
    await insert('CAI-1');
    const { deps, envoye } = fakeDeps();
    const r = await pushMouvementCaisseToComptaweb(CTX, 'CAI-1', { deps });
    expect(r).toMatchObject({ ok: true, dryRun: true });
    expect(envoye[0].dryRun).toBe(true);
    expect((await lire('CAI-1'))?.status).toBe('draft');
  });

  it('envoi réel : dépense dans la caisse CW, mode Espèces, pending_sync + id CW + n° de pièce', async () => {
    await insert('CAI-1');
    const { deps, envoye } = fakeDeps();
    const r = await pushMouvementCaisseToComptaweb(CTX, 'CAI-1', { dryRun: false, deps });
    expect(r).toMatchObject({ ok: true, dryRun: false, comptawebEcritureId: 9001 });
    const { input, cfg } = envoye[0];
    expect(cfg.cookie).toBe('c-34');
    expect(input.type).toBe('depense');
    expect(input.montant).toBe('8,00');
    expect(input.caisseId).toBe('55');
    expect(input.comptebancaireId).toBeUndefined();
    expect(input.modetransactionId).toBe('7');
    expect(input.numeropiece).toBe('CAI-1');
    expect(input.ventilations).toHaveLength(1);
    const row = await lire('CAI-1');
    expect(row).toMatchObject({ status: 'pending_sync', comptaweb_ecriture_id: 9001, numero_piece: 'CAI-1' });
  });

  it('une entrée part en recette et garde son n° de pièce', async () => {
    await insert('CAI-1', { amount_cents: 1500, type: 'entree', numero_piece: 'P-42', status: 'saisi' });
    const { deps, envoye } = fakeDeps();
    await pushMouvementCaisseToComptaweb(CTX, 'CAI-1', { dryRun: false, deps });
    expect(envoye[0].input.type).toBe('recette');
    expect(envoye[0].input.numeropiece).toBe('P-42');
    expect((await lire('CAI-1'))?.numero_piece).toBe('P-42');
  });

  it('validé comme un brouillon bancaire : nature manquante → refus, rien envoyé', async () => {
    await insert('CAI-1', { category_id: null });
    const { deps, envoye } = fakeDeps();
    const r = await pushMouvementCaisseToComptaweb(CTX, 'CAI-1', { dryRun: false, deps });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/catégorie/);
    expect(envoye).toHaveLength(0);
    expect((await lire('CAI-1'))?.status).toBe('draft');
  });

  it('sans mode Espèces dans les référentiels → refus', async () => {
    await db.exec("DELETE FROM modes_paiement WHERE id = 'mp-caisse'");
    await insert('CAI-1');
    const { deps, envoye } = fakeDeps();
    const r = await pushMouvementCaisseToComptaweb(CTX, 'CAI-1', { dryRun: false, deps });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/mode de paiement/);
    expect(envoye).toHaveLength(0);
  });

  it.each([
    ['déjà dans Comptaweb', { comptaweb_ecriture_id: 12 }, /déjà dans Comptaweb/],
    ['déjà envoyé', { status: 'pending_sync' }, /déjà envoyé/],
    ['archivé', { archived_at: '2026-10-06T00:00:00Z' }, /archivé/],
    ['dépôt (#51)', { type: 'depot' }, /brouillon bancaire/],
    ['retrait (#51)', { type: 'retrait', amount_cents: 500 }, /brouillon bancaire/],
    ['montant nul', { amount_cents: 0 }, /montant nul/],
  ])('refuse un mouvement %s', async (_nom, over, motif) => {
    await insert('CAI-1', over);
    const { deps, envoye } = fakeDeps();
    const r = await pushMouvementCaisseToComptaweb(CTX, 'CAI-1', { dryRun: false, deps });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(motif);
    expect(envoye).toHaveLength(0);
  });

  it("Comptaweb sans id d'écriture → erreur, mouvement inchangé", async () => {
    await insert('CAI-1');
    const { deps } = fakeDeps({
      createEcriture: (async () => ({ dryRun: false, warnings: [] })) as PushMouvementCaisseDeps['createEcriture'],
    });
    await expect(pushMouvementCaisseToComptaweb(CTX, 'CAI-1', { dryRun: false, deps })).rejects.toThrow(/id/);
    expect((await lire('CAI-1'))?.status).toBe('draft');
  });

  it("mouvement d'un autre groupe → introuvable", async () => {
    await insert('CAI-1', { group_id: 'g2' });
    await expect(pushMouvementCaisseToComptaweb(CTX, 'CAI-1', { deps: fakeDeps().deps })).rejects.toThrow(
      /introuvable/,
    );
  });

  it('après envoi, le sync caisse reconnaît la ligne CW par son id : aucun doublon', async () => {
    await insert('CAI-1');
    await pushMouvementCaisseToComptaweb(CTX, 'CAI-1', { dryRun: false, deps: fakeDeps().deps });
    await persistCaisseSync('g1', {
      caisseId: 55,
      libelle: 'Caisse',
      soldeDebutCentimes: 0,
      depensesCentimes: 800,
      recettesCentimes: 0,
      soldeCentimes: -800,
      mouvements: [
        {
          comptawebEcritureId: 9001,
          date: '2026-10-05',
          type: 'depense',
          montantCentimes: 800,
          intitule: 'Achat fournitures (CW)',
          numeroPiece: 'AUTRE',
          categorieTiers: null,
        },
      ],
    });
    const rows = await db.prepare('SELECT id, status, description FROM mouvements_caisse').all();
    expect(rows).toEqual([{ id: 'CAI-1', status: 'saisi', description: 'Achat fournitures (CW)' }]);
  });
});

describe('listMouvementsCaisseBalooOnly', () => {
  it('ni brouillon, ni envoyé, ni miroir, ni archivé', async () => {
    await insert('CAI-ORPH', { status: 'saisi' });
    await insert('CAI-DEPOT', { status: 'depose', type: 'depot' });
    await insert('CAI-DRAFT', { status: 'draft' });
    await insert('CAI-PEND', { status: 'pending_sync' });
    await insert('CAI-MIR', { status: 'saisi', comptaweb_ecriture_id: 3 });
    await insert('CAI-ARCH', { status: 'saisi', archived_at: '2026-10-06T00:00:00Z' });
    await insert('CAI-AUTRE', { status: 'saisi', group_id: 'g2' });
    const ids = (await listMouvementsCaisseBalooOnly(CTX)).map((m) => m.id).sort();
    expect(ids).toEqual(['CAI-DEPOT', 'CAI-ORPH']);
  });

  it("respecte le périmètre d'unités d'un chef", async () => {
    await insert('CAI-U1', { status: 'saisi', unite_id: 'u-1' });
    await insert('CAI-U2', { status: 'saisi', unite_id: 'u-2' });
    const ids = (await listMouvementsCaisseBalooOnly({ groupId: 'g1', scopeUniteIds: ['u-2'] })).map((m) => m.id);
    expect(ids).toEqual(['CAI-U2']);
  });
});

describe('rapprocherMouvementCaisseComptaweb', () => {
  it('ligne CW pas encore importée : le mouvement devient son miroir', async () => {
    await insert('CAI-ORPH', { status: 'saisi' });
    const r = await rapprocherMouvementCaisseComptaweb(CTX, 'CAI-ORPH', 4242);
    expect(r.rapproche_de).toBeNull();
    expect(r.mouvement).toMatchObject({ comptaweb_ecriture_id: 4242, status: 'saisi', archived_at: null });
  });

  it('un brouillon rapproché sort de son statut de brouillon', async () => {
    await insert('CAI-D', { status: 'draft' });
    const r = await rapprocherMouvementCaisseComptaweb(CTX, 'CAI-D', 4242);
    expect(r.mouvement.status).toBe('saisi');
  });

  it('garde un statut déposé/rapproché', async () => {
    await insert('CAI-DEP', { status: 'depose', type: 'depot' });
    const r = await rapprocherMouvementCaisseComptaweb(CTX, 'CAI-DEP', 4242);
    expect(r.mouvement.status).toBe('depose');
  });

  it('ligne CW déjà importée : miroir gardé et complété, Baloo-only archivé, rien supprimé', async () => {
    await insert('CAI-MIR', {
      status: 'saisi',
      comptaweb_ecriture_id: 4242,
      unite_id: null,
      activite_id: 'a-cw',
      amount_cents: -900,
      date_mouvement: '2026-10-07',
    });
    await insert('CAI-ORPH', { status: 'saisi', unite_id: 'u-9', activite_id: 'a-9', notes: 'ticket perdu' });
    const r = await rapprocherMouvementCaisseComptaweb(CTX, 'CAI-ORPH', 4242);
    expect(r.rapproche_de).toBe('CAI-MIR');
    expect(r.avertissements).toHaveLength(2);
    const orph = await lire('CAI-ORPH');
    expect(orph?.archived_at).toBeTruthy();
    expect(orph?.comptaweb_ecriture_id).toBeNull();
    expect(orph?.notes).toBe('ticket perdu\nRapproché de la ligne Comptaweb 4242 (mouvement CAI-MIR).');
    expect(await lire('CAI-MIR')).toMatchObject({ unite_id: 'u-9', activite_id: 'a-cw', notes: 'ticket perdu' });
    const n = await db.prepare('SELECT COUNT(*) AS n FROM mouvements_caisse').get<{ n: number }>();
    expect(n?.n).toBe(2);
    expect((await listMouvementsCaisseBalooOnly(CTX)).map((m) => m.id)).toEqual([]);
  });

  it('miroir identique : aucun avertissement, trace seule en notes', async () => {
    await insert('CAI-MIR', { status: 'saisi', comptaweb_ecriture_id: 4242 });
    await insert('CAI-ORPH', { status: 'saisi' });
    const r = await rapprocherMouvementCaisseComptaweb(CTX, 'CAI-ORPH', 4242);
    expect(r.avertissements).toEqual([]);
    expect((await lire('CAI-ORPH'))?.notes).toBe('Rapproché de la ligne Comptaweb 4242 (mouvement CAI-MIR).');
  });

  it('un miroir archivé ou d’un autre groupe ne compte pas', async () => {
    await insert('CAI-MIR', { status: 'saisi', comptaweb_ecriture_id: 4242, archived_at: '2026-10-06T00:00:00Z' });
    await insert('CAI-G2', { status: 'saisi', comptaweb_ecriture_id: 4242, group_id: 'g2' });
    await insert('CAI-ORPH', { status: 'saisi' });
    const r = await rapprocherMouvementCaisseComptaweb(CTX, 'CAI-ORPH', 4242);
    expect(r.rapproche_de).toBeNull();
    expect(r.mouvement.comptaweb_ecriture_id).toBe(4242);
  });

  it('refuse un mouvement déjà lié, archivé, ou un id CW invalide', async () => {
    await insert('CAI-LIE', { status: 'saisi', comptaweb_ecriture_id: 1 });
    await insert('CAI-ARCH', { status: 'saisi', archived_at: '2026-10-06T00:00:00Z' });
    await expect(rapprocherMouvementCaisseComptaweb(CTX, 'CAI-LIE', 4242)).rejects.toThrow(/déjà lié/);
    await expect(rapprocherMouvementCaisseComptaweb(CTX, 'CAI-ARCH', 4242)).rejects.toThrow(/archivé/);
    await expect(rapprocherMouvementCaisseComptaweb(CTX, 'CAI-ARCH', 0)).rejects.toThrow(/invalide/);
    await expect(rapprocherMouvementCaisseComptaweb(CTX, 'CAI-ARCH', 1.5)).rejects.toThrow(/invalide/);
  });
});

describe("périmètre d'unités d'un chef (push et rapprochement)", () => {
  const CHEF = { groupId: 'g1', scopeUniteIds: ['u-1'] };

  it("n'envoie pas le mouvement d'une autre unité : introuvable, rien envoyé, inchangé", async () => {
    await insert('CAI-U2', { unite_id: 'u-2' });
    const { deps, envoye } = fakeDeps();
    await expect(pushMouvementCaisseToComptaweb(CHEF, 'CAI-U2', { dryRun: false, deps })).rejects.toThrow(
      /introuvable/,
    );
    expect(envoye).toHaveLength(0);
    expect(await lire('CAI-U2')).toMatchObject({ status: 'draft', comptaweb_ecriture_id: null });
  });

  it('envoie le mouvement de son unité', async () => {
    await insert('CAI-U1', { unite_id: 'u-1' });
    const r = await pushMouvementCaisseToComptaweb(CHEF, 'CAI-U1', { dryRun: false, deps: fakeDeps().deps });
    expect(r.ok).toBe(true);
    expect((await lire('CAI-U1'))?.status).toBe('pending_sync');
  });

  it("ne rapproche pas le mouvement d'une autre unité : introuvable, ni lié ni archivé", async () => {
    await insert('CAI-U2', { status: 'saisi', unite_id: 'u-2' });
    await expect(rapprocherMouvementCaisseComptaweb(CHEF, 'CAI-U2', 4242)).rejects.toThrow(/introuvable/);
    expect(await lire('CAI-U2')).toMatchObject({ comptaweb_ecriture_id: null, archived_at: null });
  });

  it("refuse de rapprocher vers le miroir d'une autre unité", async () => {
    await insert('CAI-MIR', { status: 'saisi', comptaweb_ecriture_id: 4242, unite_id: 'u-2' });
    await insert('CAI-U1', { status: 'saisi', unite_id: 'u-1' });
    await expect(rapprocherMouvementCaisseComptaweb(CHEF, 'CAI-U1', 4242)).rejects.toThrow(/autre unité/);
    expect(await lire('CAI-U1')).toMatchObject({ comptaweb_ecriture_id: null, archived_at: null });
    expect((await lire('CAI-MIR'))?.unite_id).toBe('u-2');
  });

  it('rapproche vers un miroir sans unité ou de son unité', async () => {
    await insert('CAI-MIR0', { status: 'saisi', comptaweb_ecriture_id: 4242, unite_id: null });
    await insert('CAI-MIR1', { status: 'saisi', comptaweb_ecriture_id: 4343, unite_id: 'u-1' });
    await insert('CAI-A', { status: 'saisi', unite_id: 'u-1' });
    await insert('CAI-B', { status: 'saisi', unite_id: 'u-1' });
    expect((await rapprocherMouvementCaisseComptaweb(CHEF, 'CAI-A', 4242)).rapproche_de).toBe('CAI-MIR0');
    expect((await rapprocherMouvementCaisseComptaweb(CHEF, 'CAI-B', 4343)).rapproche_de).toBe('CAI-MIR1');
    expect((await lire('CAI-MIR0'))?.unite_id).toBe('u-1');
  });
});

describe('état Comptaweb des mouvements (#62 + #61)', () => {
  it('brouillon = draft ; envoyé à Comptaweb mais pas encore reconnu = pending', async () => {
    await insert('CAI-D', { status: 'draft' });
    await insert('CAI-P', { status: 'pending_sync' });
    const { mouvements } = await listMouvementsCaisse(CTX);
    const etats = Object.fromEntries(mouvements.map((m) => [m.id, m.etat]));
    expect(etats).toEqual({ 'CAI-D': 'draft', 'CAI-P': 'pending' });
  });
});

describe('createMouvementCaisse — nature (#61)', () => {
  it('écrit category_id quand il est fourni', async () => {
    const m = await createMouvementCaisse(CTX, {
      date_mouvement: '2026-10-05',
      description: 'x',
      amount_cents: -100,
      status: 'draft',
      category_id: 'cat-3',
    });
    expect(m).toMatchObject({ category_id: 'cat-3', status: 'draft', type: 'sortie' });
  });
});
