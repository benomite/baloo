// Agrégats bancaires supplantés par leur détail DSP2 — signalement /inbox.
//
// Quand la banque publie le détail d'un « PAIEMENT C. PROC » après coup, un
// draft par sous-ligne apparaît. Si le draft agrégé portait déjà des pièces, la
// réconciliation ne peut pas le supprimer (cf. planLineHeal) : il reste en
// doublon, son montant valant la somme des sous-lignes. Tant que N > 1, seul le
// trésorier peut reventiler — encore faut-il qu'il le VOIE : c'est ce que cette
// query rend visible, au lieu du silence qui a laissé passer ECR-2026-472.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { listAgregatsSupplantes } from './inbox-agregats';

const SETUP_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'depense',
    status TEXT NOT NULL DEFAULT 'draft',
    ligne_bancaire_id INTEGER, ligne_bancaire_sous_index INTEGER
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return db;
}

describe('listAgregatsSupplantes', () => {
  let db: DbWrapper;

  beforeEach(async () => {
    db = await setupDb();
    await db.exec(`
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, status, ligne_bancaire_id, ligne_bancaire_sous_index) VALUES
        -- ligne 111 : agrégat + 2 sous-lignes → doublon à signaler
        ('AGREGAT',  'g1', '2026-07-09', 'Camp Orange',  24635, 'draft',  111, NULL),
        ('SUB0',     'g1', '2026-07-09', 'INTERMARCHE',  20000, 'draft',  111, 0),
        ('SUB1',     'g1', '2026-07-09', 'BOULANGERIE',   4635, 'draft',  111, 1),
        -- ligne 222 : agrégat seul, détail pas encore publié → normal
        ('SEUL',     'g1', '2026-08-04', 'PAIEMENT CB',  47444, 'draft',  222, NULL),
        -- ligne 333 : agrégat déjà matérialisé dans CW → hors périmètre draft
        ('MIRROR',   'g1', '2026-06-01', 'Déjà dans CW',  1000, 'mirror', 333, NULL),
        ('M-SUB0',   'g1', '2026-06-01', 'COMMERCANT',    1000, 'draft',  333, 0),
        -- ligne 444 : même situation mais autre groupe → cloisonnement
        ('AUTRE',    'g2', '2026-07-09', 'Autre groupe',  5000, 'draft',  444, NULL),
        ('AUTRE-S0', 'g2', '2026-07-09', 'COMMERCANT',    5000, 'draft',  444, 0);
    `);
  });

  it('remonte l’agrégat dont la ligne porte aussi des sous-lignes', async () => {
    const rows = await listAgregatsSupplantes({ groupId: 'g1' }, db);
    expect(rows.map((r) => r.id)).toEqual(['AGREGAT']);
  });

  it('indique combien de sous-lignes le remplacent (pour guider la reventilation)', async () => {
    const rows = await listAgregatsSupplantes({ groupId: 'g1' }, db);
    expect(rows[0].nb_sous_lignes).toBe(2);
    expect(rows[0].amount_cents).toBe(24635);
    expect(rows[0].description).toBe('Camp Orange');
  });

  it('ignore un agrégat dont le détail n’est pas encore publié', async () => {
    const rows = await listAgregatsSupplantes({ groupId: 'g1' }, db);
    expect(rows.map((r) => r.id)).not.toContain('SEUL');
  });

  it('ignore un agrégat déjà matérialisé dans Comptaweb', async () => {
    const rows = await listAgregatsSupplantes({ groupId: 'g1' }, db);
    expect(rows.map((r) => r.id)).not.toContain('MIRROR');
  });

  it('ne fuit pas entre groupes', async () => {
    const rows = await listAgregatsSupplantes({ groupId: 'g2' }, db);
    expect(rows.map((r) => r.id)).toEqual(['AUTRE']);
  });
});
