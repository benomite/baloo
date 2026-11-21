// Fusion de brouillons bancaires (ticket #49) : une famille qui paie une même
// chose en plusieurs virements → un brouillon par ligne bancaire, une seule
// écriture voulue en compta.
//
// Critères tenus ici :
//   - un seul brouillon dont le montant est la somme, avec l'intitulé /
//     l'imputation / le découpage choisis ;
//   - les absorbés ne sont jamais supprimés : statut `fusionne`,
//     `fusionne_dans_id` = la cible, ligne bancaire conservée ;
//   - la cible reste reliée à TOUTES les lignes bancaires ;
//   - justificatifs, dépôts, remboursements et notes passent sur la cible ;
//   - refus clair pour tout ce qui n'est pas un brouillon ;
//   - le journal (listEcritures) et les totaux n'en montrent qu'une ligne.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
let idCounter = 0;
vi.mock('../../ids', () => ({
  nextIdOn: async (_db: unknown, p: string) => `${p}-V${++idCounter}`,
  nextId: async (p: string) => `${p}-V${++idCounter}`,
  currentTimestamp: () => '2026-11-21T10:00:00Z',
}));

import { fusionnerBrouillons } from '../ecritures-fusion';
import { listEcritures, updateEcriture, batchUpdateEcritures } from '../ecritures';
import { selectAnneeParUnite } from '../annee';

const G = 'g1';
const ctx = { groupId: G };

// Base sur fichier temporaire : `db.transaction` rouvre une connexion, qu'une
// base `file::memory:` nue ne suivrait pas (cf. ecritures-ventilate.test).
// Pas de table `avances_camp` ni `depots_especes` : la fusion doit sauter une
// table de pièces absente (créée à la demande par son service en prod).
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baloo-fusion-'));
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  await client.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(client);
  await testDb.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT, date_ecriture TEXT NOT NULL,
      description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
      category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, carte_id TEXT, numero_piece TEXT,
      status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1,
      comptaweb_synced INTEGER NOT NULL DEFAULT 0, ligne_bancaire_id INTEGER,
      ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER, ventilation_group_id TEXT,
      libelle_origine TEXT, fusionne_dans_id TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-11-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-11-01T00:00:00Z'
    );
    CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
    CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
    CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
    CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT, name TEXT, couleur TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE modes_paiement (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE activites (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE cartes (id TEXT PRIMARY KEY, porteur TEXT, type TEXT);
  `);
});

interface Draft {
  id: string;
  amount: number;
  type?: string;
  status?: string;
  cwId?: number | null;
  ligne?: number | null;
  vg?: string | null;
  notes?: string | null;
  description?: string;
  category?: string | null;
  unite?: string | null;
  activite?: string | null;
}

async function insert(d: Draft) {
  await testDb
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine, amount_cents, type,
         status, comptaweb_ecriture_id, ligne_bancaire_id, ventilation_group_id, notes,
         category_id, unite_id, activite_id)
       VALUES (?, ?, '2026-10-05', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      d.id, G, d.description ?? `VIR DE M DUPONT ${d.id}`, `VIR DE M DUPONT ${d.id}`, d.amount,
      d.type ?? 'recette', d.status ?? 'draft', d.cwId ?? null, d.ligne === undefined ? 100 + Number(d.id.slice(-1)) : d.ligne,
      d.vg ?? null, d.notes === undefined ? `Draft généré depuis ligne bancaire ${d.id}.` : d.notes,
      d.category ?? null, d.unite ?? null, d.activite ?? null,
    );
}

async function row(id: string) {
  return testDb
    .prepare('SELECT * FROM ecritures WHERE id = ?')
    .get<{
      id: string; status: string; amount_cents: number; fusionne_dans_id: string | null; notes: string | null;
      description: string; category_id: string | null; unite_id: string | null; activite_id: string | null;
      ligne_bancaire_id: number | null; ventilation_group_id: string | null;
    }>(id);
}

beforeEach(async () => {
  idCounter = 0;
  await testDb.exec(`
    DELETE FROM ecritures; DELETE FROM justificatifs; DELETE FROM depots_justificatifs; DELETE FROM remboursements;
  `);
});

describe('fusionnerBrouillons — fusion réussie', () => {
  beforeEach(async () => {
    await insert({ id: 'ECR-1', amount: 10000, category: 'CAT-A', unite: 'U-A', activite: 'ACT-A' });
    await insert({ id: 'ECR-2', amount: 5000, notes: 'Famille Dupont, 2e virement.' });
    await insert({ id: 'ECR-3', amount: 2500 });
  });

  it('un seul brouillon au montant de la somme ; les absorbés passent en fusionne, jamais supprimés', async () => {
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2', 'ECR-3'] }, testDb);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.id).toBe('ECR-1');
    expect(res.amount_cents).toBe(17500);
    expect(res.absorbes).toEqual(['ECR-2', 'ECR-3']);

    const cible = await row('ECR-1');
    expect(cible?.status).toBe('draft');
    expect(cible?.amount_cents).toBe(17500);
    for (const id of ['ECR-2', 'ECR-3']) {
      const r = await row(id);
      expect(r?.status).toBe('fusionne');
      expect(r?.fusionne_dans_id).toBe('ECR-1');
      // La ligne bancaire reste : c'est elle qui empêche le scan de recréer.
      expect(r?.ligne_bancaire_id).toBe(100 + Number(id.slice(-1)));
      expect(r?.notes).toContain('Fusionné le 2026-11-21 dans ECR-1.');
    }
    const n = await testDb.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
    expect(n?.n).toBe(3);
  });

  it('la cible reste reliée à toutes les lignes bancaires d’origine', async () => {
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2', 'ECR-3'] }, testDb);
    if (!res.ok) throw new Error(res.message);
    expect(res.lignes_bancaires.map((l) => [l.ecriture_id, l.ligne_bancaire_id])).toEqual([
      ['ECR-1', 101],
      ['ECR-2', 102],
      ['ECR-3', 103],
    ]);
  });

  it('garde par défaut l’intitulé et l’imputation de la cible', async () => {
    await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'] }, testDb);
    const cible = await row('ECR-1');
    expect(cible?.description).toBe('VIR DE M DUPONT ECR-1');
    expect(cible?.category_id).toBe('CAT-A');
    expect(cible?.unite_id).toBe('U-A');
    expect(cible?.activite_id).toBe('ACT-A');
  });

  it('applique l’intitulé et l’imputation choisis', async () => {
    const res = await fusionnerBrouillons(
      ctx,
      {
        cibleId: 'ECR-1', absorbesIds: ['ECR-2'],
        description: ' Inscription famille Dupont ', category_id: 'CAT-B', unite_id: 'U-B', activite_id: 'ACT-B',
      },
      testDb,
    );
    expect(res.ok).toBe(true);
    const cible = await row('ECR-1');
    expect(cible?.description).toBe('Inscription famille Dupont');
    expect(cible?.category_id).toBe('CAT-B');
    expect(cible?.unite_id).toBe('U-B');
    expect(cible?.activite_id).toBe('ACT-B');
  });

  it('reporte justificatifs, dépôts, remboursements et notes des absorbés sur la cible', async () => {
    await testDb.exec(`
      INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('J1', 'ecriture', 'ECR-2'), ('J9', 'depot', 'ECR-2');
      INSERT INTO depots_justificatifs (id, ecriture_id) VALUES ('D1', 'ECR-3');
      INSERT INTO remboursements (id, ecriture_id) VALUES ('R1', 'ECR-2');
    `);
    await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2', 'ECR-3'] }, testDb);
    const j = await testDb.prepare("SELECT entity_id FROM justificatifs WHERE id = 'J1'").get<{ entity_id: string }>();
    expect(j?.entity_id).toBe('ECR-1');
    // Un fichier rattaché à autre chose qu'une écriture n'est pas touché.
    const j9 = await testDb.prepare("SELECT entity_id FROM justificatifs WHERE id = 'J9'").get<{ entity_id: string }>();
    expect(j9?.entity_id).toBe('ECR-2');
    const d = await testDb.prepare("SELECT ecriture_id FROM depots_justificatifs WHERE id = 'D1'").get<{ ecriture_id: string }>();
    expect(d?.ecriture_id).toBe('ECR-1');
    const r = await testDb.prepare("SELECT ecriture_id FROM remboursements WHERE id = 'R1'").get<{ ecriture_id: string }>();
    expect(r?.ecriture_id).toBe('ECR-1');

    const cible = await row('ECR-1');
    expect(cible?.notes).toContain('Draft généré depuis ligne bancaire ECR-1.');
    expect(cible?.notes).toMatch(/Fusion du 2026-11-21 : absorbe ECR-2 \(50,00\s€\), ECR-3 \(25,00\s€\)\./);
    expect(cible?.notes).toContain('[ECR-2] Famille Dupont, 2e virement.');
    expect(cible?.notes).toContain('[ECR-3] Draft généré depuis ligne bancaire ECR-3.');
  });

  it('découpe l’écriture fusionnée selon les ventilations choisies', async () => {
    const res = await fusionnerBrouillons(
      ctx,
      {
        cibleId: 'ECR-1', absorbesIds: ['ECR-2', 'ECR-3'],
        ventilations: [
          { amount_cents: 10000, category_id: 'CAT-A', unite_id: 'U-LJ' },
          { amount_cents: 7500, category_id: 'CAT-A', unite_id: 'U-SG' },
        ],
      },
      testDb,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ventilation_ids).toHaveLength(2);
    const cible = await row('ECR-1');
    expect(cible?.amount_cents).toBe(10000);
    expect(cible?.unite_id).toBe('U-LJ');
    expect(cible?.ventilation_group_id).not.toBeNull();
  });

  it('ignore la cible répétée dans les absorbés et les doublons', async () => {
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-1', 'ECR-2', 'ECR-2'] }, testDb);
    expect(res.ok).toBe(true);
    expect((await row('ECR-1'))?.amount_cents).toBe(15000);
  });
});

describe('fusionnerBrouillons — refus', () => {
  async function inchange() {
    expect((await row('ECR-1'))?.amount_cents).toBe(10000);
    expect((await row('ECR-1'))?.status).toBe('draft');
  }

  it('refuse une écriture miroir de Comptaweb, avec un message clair', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    await insert({ id: 'ECR-2', amount: 5000, status: 'mirror', cwId: 777 });
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'] }, testDb);
    expect(res).toEqual({
      ok: false,
      message: expect.stringContaining('Seuls des brouillons se fusionnent'),
    });
    if (!res.ok) expect(res.message).toContain('ECR-2 (déjà dans Comptaweb)');
    await inchange();
    expect((await row('ECR-2'))?.status).toBe('mirror');
  });

  it('refuse une écriture envoyée à Comptaweb (pending_sync) même sans id CW', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    await insert({ id: 'ECR-2', amount: 5000, status: 'pending_sync' });
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'] }, testDb);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('ECR-2 (statut pending_sync)');
    await inchange();
  });

  it('refuse un brouillon déjà relié à Comptaweb', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    await insert({ id: 'ECR-2', amount: 5000, cwId: 42 });
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-2', absorbesIds: ['ECR-1'] }, testDb);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('ECR-2 (déjà dans Comptaweb)');
    await inchange();
  });

  it('refuse un brouillon ventilé', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    await insert({ id: 'ECR-2', amount: 5000, vg: 'vg_x' });
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'] }, testDb);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('déjà ventilé(s) : ECR-2');
    await inchange();
  });

  it('refuse de mêler dépense et recette', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    await insert({ id: 'ECR-2', amount: 5000, type: 'depense' });
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'] }, testDb);
    expect(res).toEqual({ ok: false, message: 'Impossible de fusionner une dépense et une recette.' });
    await inchange();
  });

  it('refuse une écriture introuvable ou d’un autre groupe', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    const res = await fusionnerBrouillons({ groupId: 'autre' }, { cibleId: 'ECR-1', absorbesIds: ['ECR-9'] }, testDb);
    expect(res).toEqual({ ok: false, message: 'Écriture(s) introuvable(s) : ECR-1, ECR-9.' });
    await inchange();
  });

  it('annule tout si un brouillon est envoyé à Comptaweb pendant la fusion', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    await insert({ id: 'ECR-2', amount: 5000 });
    await testDb.exec("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('J1', 'ecriture', 'ECR-2')");
    // L'envoi CW passe entre la lecture des brouillons et la transaction.
    const concurrent: DbWrapper = {
      ...testDb,
      transaction: async (fn) => {
        await testDb.prepare("UPDATE ecritures SET status = 'pending_sync' WHERE id = 'ECR-2'").run();
        return testDb.transaction(fn);
      },
    };
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'] }, concurrent);
    expect(res).toEqual({
      ok: false,
      message: "Le brouillon ECR-2 a changé pendant la fusion : rien n'a été fusionné, réessaie.",
    });
    await inchange();
    const j = await testDb.prepare("SELECT entity_id FROM justificatifs WHERE id = 'J1'").get<{ entity_id: string }>();
    expect(j?.entity_id).toBe('ECR-2');
  });

  it('refuse sans brouillon à absorber', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-1'] }, testDb);
    expect(res.ok).toBe(false);
    await inchange();
  });

  it('refuse un intitulé vide', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    await insert({ id: 'ECR-2', amount: 5000 });
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'], description: '  ' }, testDb);
    expect(res.ok).toBe(false);
    await inchange();
  });

  it('refuse un découpage dont la somme ne fait pas le total, ou avec une ligne à zéro', async () => {
    await insert({ id: 'ECR-1', amount: 10000 });
    await insert({ id: 'ECR-2', amount: 5000 });
    const somme = await fusionnerBrouillons(
      ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'], ventilations: [{ amount_cents: 10000 }, { amount_cents: 4000 }] }, testDb,
    );
    expect(somme.ok).toBe(false);
    if (!somme.ok) expect(somme.message).toMatch(/total fusionné \(150,00\s€\)/);
    const zero = await fusionnerBrouillons(
      ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'], ventilations: [{ amount_cents: 15000 }, { amount_cents: 0 }] }, testDb,
    );
    expect(zero.ok).toBe(false);
    await inchange();
    expect((await row('ECR-2'))?.status).toBe('draft');
  });
});

describe('après fusion : une seule ligne dans le journal et les totaux', () => {
  beforeEach(async () => {
    await insert({ id: 'ECR-1', amount: 10000, unite: 'U-A' });
    await insert({ id: 'ECR-2', amount: 5000, unite: 'U-A' });
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-1', absorbesIds: ['ECR-2'] }, testDb);
    expect(res.ok).toBe(true);
  });

  it('le journal ne montre que l’écriture fusionnée', async () => {
    const { ecritures, total } = await listEcritures(ctx);
    expect(ecritures.map((e) => e.id)).toEqual(['ECR-1']);
    expect(total).toBe(1);
    const aTraiter = await listEcritures(ctx, { bucket: 'a_traiter' });
    expect(aTraiter.ecritures.map((e) => e.id)).toEqual(['ECR-1']);
  });

  it('les absorbés restent consultables en filtrant le statut fusionne, avec leur cible', async () => {
    const { ecritures } = await listEcritures(ctx, { status: 'fusionne' });
    expect(ecritures.map((e) => [e.id, e.fusionne_dans_id])).toEqual([['ECR-2', 'ECR-1']]);
    const parListe = await listEcritures(ctx, { statusIn: ['draft', 'fusionne'] });
    expect(parListe.total).toBe(2);
  });

  it('les totaux par unité ne comptent le paiement qu’une fois', async () => {
    const rows = await selectAnneeParUnite(testDb, G, { start: '2026-09-01', end: '2027-08-31' }, []);
    expect(rows).toEqual([expect.objectContaining({ unite_id: 'U-A', recettes: 15000, nb: 1 })]);
  });

  it('un absorbé est figé : ni l’édition ni l’édition en masse ne le modifient', async () => {
    await updateEcriture(ctx, 'ECR-2', { amount_cents: 1, category_id: 'CAT-Z' });
    expect((await row('ECR-2'))?.amount_cents).toBe(5000);
    expect((await row('ECR-2'))?.category_id).toBeNull();
    // Un brouillon, lui, reste éditable.
    await updateEcriture(ctx, 'ECR-1', { category_id: 'CAT-Z' });
    expect((await row('ECR-1'))?.category_id).toBe('CAT-Z');

    const batch = await batchUpdateEcritures(ctx, ['ECR-1', 'ECR-2'], { category_id: 'CAT-Y' });
    expect(batch).toEqual({ updated: 1, skipped: 1 });
    expect((await row('ECR-2'))?.category_id).toBeNull();
    expect((await row('ECR-1'))?.category_id).toBe('CAT-Y');
  });

  it('un absorbé ne peut pas être fusionné à nouveau', async () => {
    await insert({ id: 'ECR-3', amount: 2500 });
    const res = await fusionnerBrouillons(ctx, { cibleId: 'ECR-3', absorbesIds: ['ECR-2'] }, testDb);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('ECR-2 (statut fusionne)');
  });
});
