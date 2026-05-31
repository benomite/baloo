import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient } from '../../db';
import { ensureReconcileSchema } from '../../db/business-schema';
import {
  upsertSuggestion,
  listSuggestions,
  resolveSuggestion,
  getSuggestion,
} from '../cw-link-suggestions';

type Db = ReturnType<typeof wrapClient>;

async function setupDb(): Promise<Db> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  // ensureReconcileSchema crée cw_link_suggestions (et tente des ALTER sur
  // ecritures/sync_runs absents → no-op grâce aux gardes PRAGMA).
  await ensureReconcileSchema(db);
  return db;
}

const base = { groupId: 'G', ecritureId: 'D1', cwEcritureId: 500, cwNumeroPiece: 'ECR-500' };

describe('cw-link-suggestions', () => {
  let db: Db;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('crée une suggestion a_confirmer', async () => {
    const id = await upsertSuggestion(db, base);
    expect(id).not.toBeNull();
    const list = await listSuggestions(db, 'G');
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('a_confirmer');
    expect(list[0].cw_ecriture_id).toBe(500);
  });

  it('ne crée pas de doublon pour le même couple (ecriture, cw)', async () => {
    const id1 = await upsertSuggestion(db, base);
    const id2 = await upsertSuggestion(db, base);
    expect(id2).toBe(id1);
    const list = await listSuggestions(db, 'G');
    expect(list).toHaveLength(1);
  });

  it('confirme une suggestion (sort de la liste a_confirmer)', async () => {
    const id = await upsertSuggestion(db, base);
    await resolveSuggestion(db, id!, 'confirme');
    expect(await listSuggestions(db, 'G', 'a_confirmer')).toHaveLength(0);
    expect(await listSuggestions(db, 'G', 'confirme')).toHaveLength(1);
    const s = await getSuggestion(db, id!);
    expect(s?.resolved_at).not.toBeNull();
  });

  it('ne ressuscite pas une suggestion rejetée', async () => {
    const id = await upsertSuggestion(db, base);
    await resolveSuggestion(db, id!, 'rejete');
    const reupsert = await upsertSuggestion(db, base);
    expect(reupsert).toBeNull();
    expect(await listSuggestions(db, 'G', 'a_confirmer')).toHaveLength(0);
  });
});
