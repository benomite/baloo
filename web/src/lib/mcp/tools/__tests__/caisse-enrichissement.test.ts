// #62 — cas de bord des outils caisse : chaque filtre de
// list_mouvements_caisse, les trois états dérivés, le solde Comptaweb
// injoignable, le verrou miroir champ par champ, le scope d'un chef et
// la pièce jointe sur un mouvement inconnu.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { tmpdir } from 'os';
import { join } from 'path';
import { wrapClient, type DbWrapper } from '@/lib/db';
import { captureTools, parseToolResult } from './test-helpers';
import { registerCaisseTools } from '../caisse';
import { ensureBusinessSchema } from '@/lib/db/business-schema';
import { syncCaisseFromComptaweb } from '@/lib/services/caisse-sync';

process.env.JUSTIFICATIFS_DIR = join(tmpdir(), 'baloo-test-justifs-62');

let testDb: DbWrapper;
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('@/lib/services/caisse-sync', () => ({
  syncCaisseFromComptaweb: vi.fn(async () => ({
    caisseId: 1,
    libelle: 'Caisse',
    soldeComptaweb: 7500,
    soldeBaloo: 200,
    stats: { pulled: 0, inserted: 0, matched_by_cw_id: 0, matched_by_fallback: 0, unchanged: 0 },
  })),
  discoverCaisses: vi.fn(async () => []),
  resolveCaisseId: vi.fn(async () => 1),
}));

// `ensureBusinessSchema` ne tourne qu'une fois par process : une seule BDD
// pour le fichier, vidée puis remplie avant chaque cas.
async function seed(): Promise<void> {
  if (!testDb) {
    testDb = wrapClient(createClient({ url: 'file::memory:' }));
    await ensureBusinessSchema();
  }
  await testDb.exec(`
    DELETE FROM justificatifs;
    DELETE FROM mouvements_caisse;
    DELETE FROM unites;
    DELETE FROM activites;
    DELETE FROM categories;
  `);
  await testDb.exec(`
    INSERT INTO unites (id, group_id, code, name) VALUES ('U1', 'g-test', 'LJ', 'Louveteaux'), ('U2', 'g-test', 'SG', 'Scouts');
    INSERT INTO activites (id, group_id, name) VALUES ('A1', 'g-test', 'Camp');
    INSERT INTO categories (id, name) VALUES ('C1', 'Alimentation'), ('C2', 'Matériel');
    INSERT INTO mouvements_caisse
      (id, group_id, date_mouvement, description, amount_cents, type, status, numero_piece,
       unite_id, activite_id, category_id, notes, comptaweb_ecriture_id, archived_at)
    VALUES
      ('CAI-A', 'g-test', '2026-04-02', 'Cotisation', 1000, 'entree', 'saisi', 'ESP-1', 'U1', 'A1', 'C1', 'famille Dupont', NULL, NULL),
      ('CAI-B', 'g-test', '2026-05-10', 'Courses', -500, 'sortie', 'saisi', NULL, 'U2', NULL, NULL, NULL, 42, NULL),
      ('CAI-C', 'g-test', '2026-05-20', 'Dépôt banque', -300, 'depot', 'depose', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
      ('CAI-Z', 'g-test', '2026-05-21', 'Archivé', 9999, 'entree', 'saisi', NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-01');
  `);
}

type Liste = {
  solde_baloo: string;
  solde_comptaweb: string | null;
  solde_comptaweb_erreur?: string;
  total: number;
  mouvements: Array<Record<string, unknown> & { id: string }>;
};

async function lister(params: Record<string, unknown> = {}): Promise<Liste> {
  const tools = captureTools(registerCaisseTools);
  return parseToolResult(await tools.list_mouvements_caisse.handler(params)) as Liste;
}

async function ids(params: Record<string, unknown>): Promise<string[]> {
  return (await lister(params)).mouvements.map((m) => m.id);
}

async function row(id: string) {
  return testDb
    .prepare('SELECT description, category_id, unite_id, activite_id, notes FROM mouvements_caisse WHERE id = ?')
    .get<Record<string, string | null>>(id);
}

describe('#62 list_mouvements_caisse — filtres, états, soldes', () => {
  beforeEach(seed);

  it('dérive mirror / pending / draft et exclut les archivés', async () => {
    const r = await lister();
    const etat = Object.fromEntries(r.mouvements.map((m) => [m.id, m.etat]));
    expect(etat).toEqual({ 'CAI-A': 'draft', 'CAI-B': 'mirror', 'CAI-C': 'pending' });
    expect(r.total).toBe(3);
    expect(r.mouvements.find((m) => m.id === 'CAI-A')?.category_name).toBe('Alimentation');
  });

  it('applique chaque filtre de list_ecritures', async () => {
    expect(await ids({ date_debut: '2026-05-01' })).toEqual(['CAI-C', 'CAI-B']);
    expect(await ids({ date_fin: '2026-04-30' })).toEqual(['CAI-A']);
    expect(await ids({ month: '2026-05' })).toEqual(['CAI-C', 'CAI-B']);
    expect(await ids({ category_id: 'C1' })).toEqual(['CAI-A']);
    expect(await ids({ unite_id: 'U2' })).toEqual(['CAI-B']);
    expect(await ids({ activite_id: 'A1' })).toEqual(['CAI-A']);
    expect(await ids({ type: 'depot' })).toEqual(['CAI-C']);
    expect(await ids({ comptaweb_ecriture_id: 42 })).toEqual(['CAI-B']);
    expect(await ids({ search: 'Dupont' })).toEqual(['CAI-A']);
    expect(await ids({ search: 'ESP-1' })).toEqual(['CAI-A']);
    expect(await ids({ search: 'Courses' })).toEqual(['CAI-B']);
    expect(await ids({ status: 'draft' })).toEqual(['CAI-A']);
    expect(await ids({ status: ['mirror', 'pending'] })).toEqual(['CAI-C', 'CAI-B']);
    expect(await ids({ status: 'divergent' })).toEqual([]);
    expect(await ids({ pending_only: true })).toEqual(['CAI-C', 'CAI-A']);
  });

  it('pagine avec limit / offset et compte le total filtré', async () => {
    const r = await lister({ limit: 1, offset: 1 });
    expect(r.mouvements.map((m) => m.id)).toEqual(['CAI-B']);
    expect(r.total).toBe(3);
  });

  it('le solde Baloo est celui de la caisse, pas celui de la période filtrée', async () => {
    expect((await lister()).solde_baloo).toMatch(/2,00/);
    expect((await lister({ month: '2026-05' })).solde_baloo).toMatch(/2,00/);
    expect((await lister({ unite_id: 'U2' })).solde_baloo).toMatch(/-5,00/);
  });

  it('Comptaweb injoignable : la liste sort, solde CW null avec la raison', async () => {
    vi.mocked(syncCaisseFromComptaweb).mockRejectedValueOnce(new Error('session expirée'));
    const r = await lister();
    expect(r.solde_comptaweb).toBeNull();
    expect(r.solde_comptaweb_erreur).toMatch(/session expirée/);
    expect(r.solde_baloo).toMatch(/2,00/);
    expect(r.mouvements).toHaveLength(3);

    const ok = await lister();
    expect(ok.solde_comptaweb).toMatch(/75,00/);
    expect(ok.solde_comptaweb_erreur).toBeUndefined();
  });
});

describe('#62 update_mouvement_caisse — verrou miroir et scope', () => {
  beforeEach(seed);

  async function update(params: Record<string, unknown>, ctx = {}) {
    const tools = captureTools(registerCaisseTools, ctx);
    const res = (await tools.update_mouvement_caisse.handler(params)) as { isError?: boolean };
    return { isError: !!res.isError, body: parseToolResult(res) as Record<string, unknown> };
  }

  it('sur un miroir : notes modifiables, titre identique accepté', async () => {
    const r = await update({ id: 'CAI-B', description: 'Courses', notes: 'ticket perdu' });
    expect(r.isError).toBe(false);
    expect((await row('CAI-B'))?.notes).toBe('ticket perdu');
  });

  it.each([
    ['category_id', 'C2'],
    ['unite_id', 'U1'],
    ['activite_id', 'A1'],
  ])('sur un miroir : changer %s est refusé, rien n’est écrit', async (champ, valeur) => {
    const r = await update({ id: 'CAI-B', [champ]: valeur, notes: 'ne doit pas passer' });
    expect(r.isError).toBe(true);
    expect(String(r.body.error)).toContain(champ);
    expect(String(r.body.error)).toMatch(/Comptaweb/);
    const apres = await row('CAI-B');
    expect(apres?.[champ]).toBe(champ === 'unite_id' ? 'U2' : null);
    expect(apres?.notes).toBeNull();
  });

  it('hors miroir : vider les notes et l’imputation remet NULL', async () => {
    const r = await update({ id: 'CAI-A', notes: '', category_id: '' });
    expect(r.isError).toBe(false);
    const apres = await row('CAI-A');
    expect(apres?.notes).toBeNull();
    expect(apres?.category_id).toBeNull();
    expect(apres?.description).toBe('Cotisation');
  });

  it('refuse un titre vide', async () => {
    const r = await update({ id: 'CAI-A', description: '   ' });
    expect(r.isError).toBe(true);
    expect(String(r.body.error)).toMatch(/vide/);
    expect((await row('CAI-A'))?.description).toBe('Cotisation');
  });

  it('mouvement inconnu ou archivé : introuvable', async () => {
    for (const id of ['CAI-NOPE', 'CAI-Z']) {
      const r = await update({ id, notes: 'x' });
      expect(r.isError).toBe(true);
      expect(String(r.body.error)).toMatch(/introuvable/);
    }
  });

  it('un chef ne touche que les mouvements de ses unités, et ne les envoie pas ailleurs', async () => {
    const chef = { scopeUniteIds: ['U1'] };
    expect((await update({ id: 'CAI-B', notes: 'x' }, chef)).isError).toBe(true);
    expect((await update({ id: 'CAI-A', notes: 'sans unité' }, chef)).isError).toBe(false);
    const hors = await update({ id: 'CAI-A', unite_id: 'U2' }, chef);
    expect(hors.isError).toBe(true);
    expect(String(hors.body.error)).toMatch(/tiennes/);
    expect((await row('CAI-A'))?.unite_id).toBe('U1');
    expect((await update({ id: 'CAI-A', unite_id: 'U1', notes: 'ok' }, chef)).isError).toBe(false);
    expect((await row('CAI-A'))?.notes).toBe('ok');
  });
});

describe('#62 attach_justificatif_mouvement_caisse', () => {
  beforeEach(seed);

  async function attach(mouvement_id: string) {
    const tools = captureTools(registerCaisseTools);
    return (await tools.attach_justificatif_mouvement_caisse.handler({
      mouvement_id,
      filename: 'ticket.pdf',
      content_base64: 'JVBERi0=',
    })) as { isError?: boolean };
  }

  it('joint la pièce à un miroir (donnée Baloo-only)', async () => {
    const res = await attach('CAI-B');
    expect(res.isError).toBeFalsy();
    const rows = await testDb
      .prepare("SELECT entity_type FROM justificatifs WHERE entity_id = 'CAI-B'")
      .all<{ entity_type: string }>();
    expect(rows).toEqual([{ entity_type: 'mouvement_caisse' }]);
  });

  it('refuse un mouvement inconnu sans créer de pièce', async () => {
    const res = await attach('CAI-NOPE');
    expect(res.isError).toBe(true);
    expect(String((parseToolResult(res) as { error: string }).error)).toMatch(/introuvable/);
    const n = await testDb.prepare('SELECT COUNT(*) AS n FROM justificatifs').get<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
