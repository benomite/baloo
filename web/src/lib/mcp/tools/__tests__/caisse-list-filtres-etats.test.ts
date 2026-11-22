import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '@/lib/db';
import { captureTools, parseToolResult } from './test-helpers';
import { registerCaisseTools } from '../caisse';
import { registerEcrituresTools } from '../ecritures';
import { ensureBusinessSchema } from '@/lib/db/business-schema';

let testDb: DbWrapper;
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, getDb: () => testDb };
});
// Frontière Comptaweb : le solde côté CW vaut 75,00 €, Baloo en compte 50,00 €.
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
      VALUES ('CAI-LOCAL', 'g-test', '2026-05-10', 'Vente gâteaux', 2000, 'entree', 'saisi', 'U1', NULL),
             ('CAI-MIROIR', 'g-test', '2026-05-11', 'Courses camp', 3000, 'entree', 'rapproche', 'U2', 42);
  `);
}

describe('#62 critère 1 — list_mouvements_caisse : mêmes filtres que list_ecritures + état', () => {
  beforeEach(seed);

  it('accepte les filtres de list_ecritures et renvoie l’état de chaque mouvement', async () => {
    const ecrTools = captureTools(registerEcrituresTools);
    const tools = captureTools(registerCaisseTools);
    const schema = Object.keys(tools.list_mouvements_caisse.schema);
    for (const k of [
      'date_debut',
      'date_fin',
      'month',
      'category_id',
      'unite_id',
      'status',
      'pending_only',
      'search',
      'limit',
      'offset',
    ]) {
      expect(Object.keys(ecrTools.list_ecritures.schema)).toContain(k);
      expect(schema).toContain(k);
    }

    const r = parseToolResult(await tools.list_mouvements_caisse.handler({ limit: 50 })) as {
      mouvements: Array<Record<string, unknown>>;
    };
    const etat = (id: string) =>
      Object.values(r.mouvements.find((m) => m.id === id) ?? {}).filter((v) =>
        ['mirror', 'draft', 'pending', 'divergent'].includes(String(v)),
      );
    expect(etat('CAI-MIROIR')).toContain('mirror');
    expect(etat('CAI-LOCAL')).toHaveLength(1);
    expect(etat('CAI-LOCAL')).not.toContain('mirror');

    // Filtre par état : seul le miroir ressort.
    const f = parseToolResult(
      await tools.list_mouvements_caisse.handler({ status: 'mirror', limit: 50 }),
    ) as { mouvements: Array<{ id: string }> };
    expect(f.mouvements.map((m) => m.id)).toEqual(['CAI-MIROIR']);
  });
});
