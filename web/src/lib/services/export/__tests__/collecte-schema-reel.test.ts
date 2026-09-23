// Filet de sécurité anti-régression sur le SQL généré par `sqlPourTable` :
// les tests de `collecte.test.ts` tournent contre des fixtures écrites à la
// main (tables réduites à quelques colonnes), donc un décalage entre le
// régime déclaré dans `TABLES_INCLUSES` et le VRAI schéma (ex. `groupes`
// dont la clé est `id`, pas `group_id`) passe inaperçu. Ce test monte le
// schéma réel et exécute la requête générée pour CHAQUE table déclarée —
// c'est lui qui aurait attrapé `groupes` en régime `'group_id'`.
//
// `ensure*Schema()` ne prennent pas de paramètre : ils lisent `getDb()` en
// interne. On mocke `../../../db` pour leur injecter notre BDD en mémoire,
// comme dans `src/lib/db/__tests__/ventilation-group-migration.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';

let db: DbWrapper;

vi.mock('../../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../db')>();
  return { ...actual, getDb: () => db };
});

import { ensureAuthSchema } from '../../../auth/schema';
import { ensureAvancesSchema } from '../../camp-avances';
import { ensureInboxRejetsSchema } from '../../inbox-rejets';
import { ensureDepotsSchema } from '../../depots';
import { sqlPourTable } from '../collecte';
import { TABLES_INCLUSES } from '../tables';

describe('sqlPourTable contre le schéma réel', () => {
  it('exécute sans erreur pour toutes les tables de TABLES_INCLUSES', async () => {
    const client = createClient({ url: 'file::memory:' });
    db = wrapClient(client);

    // ensureAuthSchema() cascade déjà vers ensureBusinessSchema() en
    // interne (cf. auth/schema.ts) : groupes, ecritures, remboursements,
    // abandons_frais, etc. y sont créées.
    await ensureAuthSchema();
    // avances_camp — cascade elle-même vers ensureCampsSchema() (camps).
    await ensureAvancesSchema();
    // inbox_suggestion_rejets.
    await ensureInboxRejetsSchema();
    // depots_justificatifs (déjà créée par business-schema, IF NOT EXISTS).
    await ensureDepotsSchema();

    for (const t of TABLES_INCLUSES) {
      const { sql, args } = sqlPourTable(t);
      await expect(
        db.prepare(sql).all(...args('grp-inexistant')),
        `table ${t.nom} (régime ${t.regime})`,
      ).resolves.toBeDefined();
    }
  });
});
