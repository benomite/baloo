import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';

// Le service `groupes` tape `getDb()` : on valide ici la forme du patch et la
// migration, sur une BDD in-memory pilotée à la main.
describe('dernier_exercice_clos', () => {
  it('la migration ajoute une colonne nullable, sans valeur par défaut', async () => {
    const db = wrapClient(createClient({ url: 'file::memory:' }));
    await db.exec(`CREATE TABLE groupes (id TEXT PRIMARY KEY, code TEXT, nom TEXT)`);
    await db.exec(`INSERT INTO groupes (id, code, nom) VALUES ('g1', 'VDS', 'Val de Saône')`);

    await db.exec('ALTER TABLE groupes ADD COLUMN dernier_exercice_clos TEXT');

    const row = await db
      .prepare('SELECT dernier_exercice_clos FROM groupes WHERE id = ?')
      .get<{ dernier_exercice_clos: string | null }>('g1');
    expect(row?.dernier_exercice_clos).toBeNull();

    await db.exec(`UPDATE groupes SET dernier_exercice_clos = '2025-2026' WHERE id = 'g1'`);
    const apres = await db
      .prepare('SELECT dernier_exercice_clos FROM groupes WHERE id = ?')
      .get<{ dernier_exercice_clos: string | null }>('g1');
    expect(apres?.dernier_exercice_clos).toBe('2025-2026');
  });
});
