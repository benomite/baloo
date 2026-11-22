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
    INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, type, status, comptaweb_ecriture_id)
      VALUES ('CAI-LOCAL', 'g-test', '2026-05-10', 'Vente gâteaux', 2000, 'entree', 'saisi', NULL),
             ('CAI-MIROIR', 'g-test', '2026-05-11', 'Courses camp', 3000, 'entree', 'rapproche', 42);
  `);
}

describe('#62 critère 2 — soldes Baloo et Comptaweb côte à côte', () => {
  beforeEach(seed);

  it('le résultat de list_mouvements_caisse porte les deux soldes', async () => {
    const tools = captureTools(registerCaisseTools);
    const r = parseToolResult(await tools.list_mouvements_caisse.handler({})) as Record<
      string,
      unknown
    >;
    const entries = Object.entries(r);
    const baloo = entries.find(([k, v]) => /baloo/i.test(k) && /50,00/.test(JSON.stringify(v)));
    const cw = entries.find(([k, v]) => /comptaweb|cw/i.test(k) && /75,00/.test(JSON.stringify(v)));
    expect(baloo, JSON.stringify(r)).toBeDefined();
    expect(cw, JSON.stringify(r)).toBeDefined();
  });
});
