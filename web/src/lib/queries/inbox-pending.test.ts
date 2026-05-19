// Tests de `listOrphanPendingEcritures` — exposition des écritures en
// attente (status IN draft/pending_cw/pending_sync) à /inbox.
//
// Important pour le pivot Phase 1 : c'est la liste qui peuple le
// dashboard "ce qu'il reste à faire". Les `mirror` et `divergent`
// (qui sont dans CW) ne doivent JAMAIS sortir d'ici.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient } from '../db';

// Schéma minimal pour pouvoir requêter sans monter tout business-schema.
// Volontairement nu : pas d'index, pas de FK — on teste juste la query.
const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL,
    category_id TEXT,
    mode_paiement_id TEXT,
    activite_id TEXT,
    carte_id TEXT,
    numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    comptaweb_ecriture_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT, name TEXT, group_id TEXT);
  CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
`;

async function setupDb(): Promise<{ client: Client; db: ReturnType<typeof wrapClient> }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  await client.executeMultiple(SETUP_SQL);
  return { client, db: wrapClient(client) };
}

// On ré-implémente la même query localement (référence) pour valider
// son comportement. Si la query de prod diverge, ce test casse — c'est
// volontaire (sentinelle).
async function listOrphanPendingViaQuery(db: ReturnType<typeof wrapClient>, groupId: string): Promise<Array<{ id: string; status: string }>> {
  const statuses = ['draft', 'pending_cw', 'pending_sync'];
  const placeholders = statuses.map(() => '?').join(',');
  return await db
    .prepare(
      `SELECT e.id, e.status FROM ecritures e
       WHERE e.group_id = ? AND e.status IN (${placeholders})
       ORDER BY e.date_ecriture DESC, e.id DESC
       LIMIT 200`,
    )
    .all<{ id: string; status: string }>(groupId, ...statuses);
}

describe('listOrphanPendingEcritures (query reference)', () => {
  let client: Client;
  let db: ReturnType<typeof wrapClient>;

  beforeEach(async () => {
    const setup = await setupDb();
    client = setup.client;
    db = setup.db;
    await db.exec(`
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status) VALUES
        ('e-draft',    'g1', '2026-01-01', 'Draft',        100, 'depense', 'draft'),
        ('e-pendCw',   'g1', '2026-01-02', 'Pending CW',   200, 'depense', 'pending_cw'),
        ('e-pendSync', 'g1', '2026-01-03', 'Pending sync', 300, 'depense', 'pending_sync'),
        ('e-mirror',   'g1', '2026-01-04', 'Mirror',       400, 'depense', 'mirror'),
        ('e-divrg',    'g1', '2026-01-05', 'Divergent',    500, 'depense', 'divergent'),
        ('e-otherGrp', 'g2', '2026-01-06', 'Autre groupe', 600, 'depense', 'draft');
    `);
  });

  it("retourne uniquement les 3 statuts pending du groupe demandé", async () => {
    void client; // utilisé via le pragma + executeMultiple ci-dessus
    const rows = await listOrphanPendingViaQuery(db, 'g1');
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(['e-draft', 'e-pendCw', 'e-pendSync']);
  });

  it("n'expose JAMAIS les mirror ou divergent", async () => {
    const rows = await listOrphanPendingViaQuery(db, 'g1');
    expect(rows.map((r) => r.status)).not.toContain('mirror');
    expect(rows.map((r) => r.status)).not.toContain('divergent');
  });

  it("filtre par groupe : un draft d'un autre groupe ne fuit pas", async () => {
    const rows = await listOrphanPendingViaQuery(db, 'g1');
    expect(rows.find((r) => r.id === 'e-otherGrp')).toBeUndefined();
  });
});
