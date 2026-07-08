// Migration S0 multi-ventilation (spec
// doc/specs/2026-07-08-ecriture-multi-ventilation-design.md, Task 1) :
// colonne `ecritures.ventilation_group_id` (nullable, TEXT). Relie N lignes
// `ecritures` d'une même pièce Comptaweb AVANT que `comptaweb_ecriture_id`
// soit connu. Rien ne la consomme encore (tâches suivantes) : ce test
// vérifie uniquement que la colonne existe et accepte NULL + une valeur.
//
// `ensureBusinessSchema()` ne prend pas de paramètre : elle lit `getDb()`
// en interne (cf. business-schema.ts). On mocke `../../db` pour lui
// injecter notre BDD en mémoire, comme dans
// `src/lib/services/__tests__/depots-update.test.ts`.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let db: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => db };
});

import { ensureBusinessSchema } from '../business-schema';

describe('migration ventilation_group_id', () => {
  beforeEach(() => {
    const client = createClient({ url: 'file::memory:' });
    db = wrapClient(client);
  });

  it('la colonne ventilation_group_id existe sur ecritures et accepte NULL + une valeur', async () => {
    await ensureBusinessSchema();
    // INSERT minimal avec la colonne renseignée
    await db.prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, ventilation_group_id)
       VALUES ('ECR-1', 'g', '2026-07-08', 'test', 1000, 'depense', 'draft', 'vg_abc')`,
    ).run();
    const row = await db.prepare('SELECT ventilation_group_id FROM ecritures WHERE id = ?')
      .get<{ ventilation_group_id: string | null }>('ECR-1');
    expect(row?.ventilation_group_id).toBe('vg_abc');

    // Nullable : insert sans la colonne ne doit pas planter.
    await db.prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status)
       VALUES ('ECR-2', 'g', '2026-07-08', 'test 2', 500, 'depense', 'draft')`,
    ).run();
    const row2 = await db.prepare('SELECT ventilation_group_id FROM ecritures WHERE id = ?')
      .get<{ ventilation_group_id: string | null }>('ECR-2');
    expect(row2?.ventilation_group_id).toBeNull();
  });
});
