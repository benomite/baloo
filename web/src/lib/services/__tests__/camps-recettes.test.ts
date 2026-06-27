import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';
import { selectCampRecettes } from '../camps';

// Schéma minimal : ecritures (colonnes touchées) + categories (jointe) +
// justificatifs/remboursements vides (les EXISTS de EcritureCampRow → 0).
const SETUP_SQL = `
  CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE justificatifs (entity_type TEXT, entity_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, activite_id TEXT, unite_id TEXT,
    date_ecriture TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL, category_id TEXT, justif_attendu INTEGER NOT NULL DEFAULT 0
  );
`;

async function setupDb() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  const db = wrapClient(client);
  await db.prepare("INSERT INTO categories (id, name) VALUES ('cat-part', 'Participations'), ('cat-depot-especes', 'Transfert')").run();
  return db;
}

const ins = (id: string, over: Partial<{ act: string; uni: string; type: string; cat: string | null; amt: number; date: string }> = {}) =>
  ({ id, act: over.act ?? 'ACT1', uni: over.uni ?? 'UNI1', type: over.type ?? 'recette', cat: over.cat === undefined ? 'cat-part' : over.cat, amt: over.amt ?? 5000, date: over.date ?? '2026-07-10' });

describe('selectCampRecettes', () => {
  let db: Awaited<ReturnType<typeof setupDb>>;
  beforeEach(async () => {
    db = await setupDb();
    const rows = [
      ins('R1'),                                  // recette du camp → incluse
      ins('R2', { date: '2026-07-15' }),          // recette du camp (plus récente) → incluse, en tête
      ins('D1', { type: 'depense' }),             // dépense → exclue
      ins('R3', { uni: 'AUTRE' }),                // autre unité → exclue
      ins('R4', { act: 'AUTRE' }),                // autre activité → exclue
      ins('R5', { cat: 'cat-depot-especes' }),    // catégorie de transfert → exclue
      ins('RG', { uni: 'UNI1', act: 'ACT1' }),    // recette du camp, groupe différent → exclue (group_id)
    ];
    for (const r of rows) {
      const gid = r.id === 'RG' ? 'autre-groupe' : 'g1';
      await db.prepare(
        "INSERT INTO ecritures (id, group_id, activite_id, unite_id, date_ecriture, description, amount_cents, type, category_id) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(r.id, gid, r.act, r.uni, r.date, `desc ${r.id}`, r.amt, r.type, r.cat);
    }
  });

  it('ne retourne que les recettes du camp (activité × unité), hors transfert, triées par date desc', async () => {
    const res = await selectCampRecettes(db, 'g1', 'ACT1', 'UNI1');
    expect(res.map((e) => e.id)).toEqual(['R2', 'R1']);
    expect(res[0].type).toBe('recette');
    expect(res[0].category_name).toBe('Participations');
  });

  it('renvoie [] si aucune recette', async () => {
    expect(await selectCampRecettes(db, 'g1', 'ACT-VIDE', 'UNI1')).toEqual([]);
  });
});
