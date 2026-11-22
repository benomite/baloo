// Critère 2 (#61) : create_mouvement_caisse crée un brouillon destiné à
// Comptaweb (comme un brouillon bancaire), plus un mouvement Baloo-only
// permanent.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { captureTools, parseToolResult } from '../../mcp/tools/__tests__/test-helpers';
import { registerCaisseTools } from '../../mcp/tools/caisse';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

describe('create_mouvement_caisse — brouillon Comptaweb (#61)', () => {
  beforeEach(async () => {
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    testDb = wrapClient(client);
    await testDb.exec(`
      CREATE TABLE mouvements_caisse (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_mouvement TEXT NOT NULL,
        description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT, numero_piece TEXT,
        status TEXT NOT NULL DEFAULT 'saisi', depot_id TEXT, airtable_id TEXT,
        comptaweb_ecriture_id INTEGER, archived_at TEXT, solde_apres_cents INTEGER,
        unite_id TEXT, activite_id TEXT, notes TEXT,
        created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z'
      );
    `);
  });

  it("l'outil crée un mouvement au statut draft, pas encore lié à Comptaweb", async () => {
    const tools = captureTools(registerCaisseTools);
    const r = await tools.create_mouvement_caisse.handler({
      date_mouvement: '2026-10-05',
      description: 'Achat fournitures',
      montant: '-8,00',
    });
    const parsed = parseToolResult(r) as { id: string };
    const row = await testDb
      .prepare('SELECT status, comptaweb_ecriture_id FROM mouvements_caisse WHERE id = ?')
      .get<{ status: string; comptaweb_ecriture_id: number | null }>(parsed.id);
    expect(row?.status).toBe('draft');
    expect(row?.comptaweb_ecriture_id).toBeNull();
  });

  it("l'outil ne se présente plus comme une saisie Baloo-only permanente", () => {
    const tools = captureTools(registerCaisseTools);
    expect(tools.create_mouvement_caisse.description).not.toContain('Baloo-only');
    expect(tools.create_mouvement_caisse.description.toLowerCase()).toMatch(/brouillon|draft/);
  });
});
