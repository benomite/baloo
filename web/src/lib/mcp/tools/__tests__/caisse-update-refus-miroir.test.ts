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
    INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, type, status, comptaweb_ecriture_id)
      VALUES ('CAI-MIROIR', 'g-test', '2026-05-11', 'Courses camp', 3000, 'entree', 'rapproche', 42);
  `);
}

const UPDATE_RE = /^(update|modifier|edit)_.*(mouvement|caisse)/;

describe('#62 critère 5 — champ Comptaweb refusé sur un mouvement miroir', () => {
  beforeEach(seed);

  it('refuse de changer le titre d’un mouvement miroir, nomme le champ, ne change rien', async () => {
    const tools = captureTools(registerCaisseTools);
    const update = Object.values(tools).find((t) => UPDATE_RE.test(t.name));
    expect(update, Object.keys(tools).join(',')).toBeDefined();

    let texte: string;
    try {
      const p = parseToolResult(await update!.handler({ id: 'CAI-MIROIR', description: 'Titre piraté' }));
      texte = typeof p === 'string' ? p : JSON.stringify(p);
    } catch (e) {
      texte = (e as Error).message;
    }
    expect(texte).toMatch(/description|titre/i);
    expect(texte).toMatch(/comptaweb|refus|interdit|impossible/i);

    const row = await testDb
      .prepare('SELECT description FROM mouvements_caisse WHERE id = ?')
      .get<{ description: string }>('CAI-MIROIR');
    expect(row?.description).toBe('Courses camp');
  });
});
