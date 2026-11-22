import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '@/lib/db';
import { captureTools } from './test-helpers';
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
      VALUES ('CAI-LOCAL', 'g-test', '2026-05-10', 'Vente gâteaux', 2000, 'entree', 'saisi', NULL);
  `);
}

const UPDATE_RE = /^(update|modifier|edit)_.*(mouvement|caisse)/;
const ATTACH_RE =
  /(attach|justif|piece).*(mouvement|caisse)|(mouvement|caisse).*(attach|justif|piece)/;

describe('#62 critère 4 — rattacher un justificatif à un mouvement de caisse', () => {
  beforeEach(seed);

  it('un outil MCP de caisse rattache un justificatif au mouvement', async () => {
    const tools = captureTools(registerCaisseTools);
    const all = Object.values(tools);
    const attach = all.find((t) => ATTACH_RE.test(t.name)) ?? all.find((t) => UPDATE_RE.test(t.name));
    expect(attach, Object.keys(tools).join(',')).toBeDefined();

    await attach!.handler({
      id: 'CAI-LOCAL',
      mouvement_id: 'CAI-LOCAL',
      mouvement_caisse_id: 'CAI-LOCAL',
      entity_type: 'mouvement_caisse',
      entity_id: 'CAI-LOCAL',
      justificatif_id: 'JUS-1',
      file_path: '/blob/ticket-caisse.pdf',
      original_filename: 'ticket-caisse.pdf',
      filename: 'ticket-caisse.pdf',
      mime_type: 'application/pdf',
      content_base64: 'JVBERi0=',
    });

    const rows = await testDb
      .prepare('SELECT id FROM justificatifs WHERE entity_id = ?')
      .all<{ id: string }>('CAI-LOCAL');
    expect(rows.length).toBeGreaterThan(0);
  });
});
