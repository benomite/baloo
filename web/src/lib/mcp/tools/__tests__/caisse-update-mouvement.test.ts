import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '@/lib/db';
import { captureTools, parseToolResult } from './test-helpers';
import { registerCaisseTools } from '../caisse';
import { ensureBusinessSchema } from '@/lib/db/business-schema';

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
    soldeBaloo: 5000,
    stats: { pulled: 0, inserted: 0, matched_by_cw_id: 0, matched_by_fallback: 0, unchanged: 0 },
  })),
  discoverCaisses: vi.fn(async () => [
    { id: 1, libelle: 'Caisse', gerant: 'X', devise: 'EUR', inactif: false },
  ]),
  resolveCaisseId: vi.fn(async () => 1),
}));

async function seed(): Promise<void> {
  testDb = wrapClient(createClient({ url: 'file::memory:' }));
  await ensureBusinessSchema();
  await testDb.exec(`
    INSERT INTO unites (id, group_id, code, name) VALUES ('U1', 'g-test', 'LJ', 'Louveteaux'), ('U2', 'g-test', 'SG', 'Scouts');
    INSERT INTO activites (id, group_id, name) VALUES ('A1', 'g-test', 'Camp');
    INSERT INTO categories (id, name) VALUES ('C1', 'Alimentation');
    INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, type, status, unite_id, comptaweb_ecriture_id)
      VALUES ('CAI-LOCAL', 'g-test', '2026-05-10', 'Vente gâteaux', 2000, 'entree', 'saisi', 'U1', NULL);
  `);
}

const UPDATE_RE = /^(update|modifier|edit)_.*(mouvement|caisse)/;

describe('#62 critère 3 — modifier un mouvement de caisse', () => {
  beforeEach(seed);

  it('modifie titre, catégorie, unité, activité, notes ; visible au list suivant', async () => {
    const tools = captureTools(registerCaisseTools);
    const update = Object.values(tools).find((t) => UPDATE_RE.test(t.name));
    expect(update, Object.keys(tools).join(',')).toBeDefined();

    await update!.handler({
      id: 'CAI-LOCAL',
      description: 'Vente de gâteaux (kermesse)',
      category_id: 'C1',
      unite_id: 'U2',
      activite_id: 'A1',
      notes: 'à justifier',
    });

    const r = parseToolResult(await tools.list_mouvements_caisse.handler({ limit: 50 })) as {
      mouvements: Array<Record<string, unknown>>;
    };
    const m = r.mouvements.find((x) => x.id === 'CAI-LOCAL')!;
    expect(m.description).toBe('Vente de gâteaux (kermesse)');
    expect(m.category_id).toBe('C1');
    expect(m.unite_id).toBe('U2');
    expect(m.activite_id).toBe('A1');
    expect(m.notes).toBe('à justifier');
  });
});
