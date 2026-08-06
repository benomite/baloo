// Cas terrain 2026-08-03 : « Suppression refusée : une pièce est attachée »
// était un cul-de-sac — le message ne disait NI laquelle, NI où aller la
// détacher. `listAttachments` nomme les pièces, `describeBlockers` les regroupe
// pour l'UI (les fichiers issus d'un dépôt suivent leur dépôt, seul objet que
// l'utilisateur peut détacher).

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import {
  listAttachments,
  listAttachmentsFor,
  describeBlockers,
  type Attachment,
} from '../ecritures-arbitrage';

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE justificatifs (
      id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT,
      original_filename TEXT, file_path TEXT
    );
    CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT, titre TEXT);
    CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT, date_depot TEXT);
    CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT, demandeur TEXT);
    CREATE TABLE avances_camp (id TEXT PRIMARY KEY, ecriture_id TEXT, beneficiaire TEXT);
  `);
  return db;
}

describe('listAttachments — nommer les pièces qui bloquent', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('ne renvoie rien pour une écriture sans pièce', async () => {
    expect(await listAttachments(db, 'ECR-A')).toEqual([]);
  });

  it('nomme chaque type de pièce avec un libellé lisible', async () => {
    await db
      .prepare(
        `INSERT INTO justificatifs (id, entity_type, entity_id, original_filename, file_path)
         VALUES ('JUS-1','ecriture','ECR-A','ficelle.jpg','depot/DEP-1/JUS-1-ficelle.jpg')`,
      )
      .run();
    await db.prepare(`INSERT INTO depots_justificatifs VALUES ('DEP-1','ECR-A','Avance territoire')`).run();
    await db.prepare(`INSERT INTO depots_especes VALUES ('DEPE-1','ECR-A','2026-07-01')`).run();
    await db.prepare(`INSERT INTO remboursements VALUES ('REMB-1','ECR-A','Camille Martin')`).run();
    await db.prepare(`INSERT INTO avances_camp VALUES ('AVC-1','ECR-A','Chef Orange')`).run();

    const atts = await listAttachments(db, 'ECR-A');

    expect(atts).toHaveLength(5);
    expect(atts.find((a) => a.kind === 'justificatif')).toMatchObject({
      id: 'JUS-1',
      label: 'ficelle.jpg',
      from_depot_id: 'DEP-1',
    });
    expect(atts.find((a) => a.kind === 'depot')).toMatchObject({ id: 'DEP-1' });
    expect(atts.find((a) => a.kind === 'depot')?.label).toContain('Avance territoire');
    expect(atts.find((a) => a.kind === 'depot_especes')?.label).toContain('2026-07-01');
    expect(atts.find((a) => a.kind === 'remboursement')?.label).toContain('Camille Martin');
    expect(atts.find((a) => a.kind === 'avance_camp')?.label).toContain('Chef Orange');
  });

  it("ignore les pièces d'une AUTRE écriture", async () => {
    await db.prepare(`INSERT INTO depots_justificatifs VALUES ('DEP-1','ECR-B','ailleurs')`).run();
    expect(await listAttachments(db, 'ECR-A')).toEqual([]);
  });

  it('ne compte pas un justif rapatrié vers le dépôt (entity_type=depot)', async () => {
    await db
      .prepare(
        `INSERT INTO justificatifs (id, entity_type, entity_id, original_filename, file_path)
         VALUES ('JUS-1','depot','DEP-1','ficelle.jpg','depot/DEP-1/JUS-1-ficelle.jpg')`,
      )
      .run();
    expect(await listAttachments(db, 'ECR-A')).toEqual([]);
  });

  it('survit à une table satellite absente', async () => {
    await db.exec('DROP TABLE avances_camp;');
    await db.prepare(`INSERT INTO depots_justificatifs VALUES ('DEP-1','ECR-A','t')`).run();
    const atts = await listAttachments(db, 'ECR-A');
    expect(atts.map((a) => a.kind)).toEqual(['depot']);
  });

  it('compte quand même les justifs si les colonnes de libellé manquent', async () => {
    await db.exec(
      `DROP TABLE justificatifs;
       CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT);
       INSERT INTO justificatifs VALUES ('JUS-1','ecriture','ECR-A');`,
    );
    const atts = await listAttachments(db, 'ECR-A');
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ kind: 'justificatif', id: 'JUS-1', from_depot_id: null });
  });

  it('retombe sur un libellé générique si la colonne de libellé manque', async () => {
    await db.exec('DROP TABLE remboursements; CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);');
    await db.prepare(`INSERT INTO remboursements VALUES ('REMB-1','ECR-A')`).run();
    const atts = await listAttachments(db, 'ECR-A');
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ kind: 'remboursement', id: 'REMB-1' });
    expect(atts[0].label).toBeTruthy();
  });
});

describe('listAttachmentsFor — version groupée (une requête par table)', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('range chaque pièce sous SON écriture, sans mélange', async () => {
    await db.prepare(`INSERT INTO depots_justificatifs VALUES ('DEP-1','ECR-A','dépôt A')`).run();
    await db.prepare(`INSERT INTO remboursements VALUES ('REMB-1','ECR-B','Camille Martin')`).run();
    await db
      .prepare(
        `INSERT INTO justificatifs (id, entity_type, entity_id, original_filename, file_path)
         VALUES ('JUS-1','ecriture','ECR-B','facture.pdf','ecriture/ECR-B/JUS-1-facture.pdf')`,
      )
      .run();

    const map = await listAttachmentsFor(db, ['ECR-A', 'ECR-B', 'ECR-C']);

    expect(map.get('ECR-A')?.map((a) => a.id)).toEqual(['DEP-1']);
    expect(map.get('ECR-B')?.map((a) => a.id).sort()).toEqual(['JUS-1', 'REMB-1']);
    expect(map.get('ECR-C')).toEqual([]);
  });

  it('renvoie une entrée vide pour chaque id demandé, même sans pièce', async () => {
    const map = await listAttachmentsFor(db, ['ECR-A', 'ECR-B']);
    expect([...map.keys()].sort()).toEqual(['ECR-A', 'ECR-B']);
    expect([...map.values()].every((v) => v.length === 0)).toBe(true);
  });

  it("n'ajoute pas d'entrée pour une écriture hors périmètre", async () => {
    await db.prepare(`INSERT INTO depots_justificatifs VALUES ('DEP-9','ECR-Z','hors périmètre')`).run();

    const map = await listAttachmentsFor(db, ['ECR-A']);

    expect(map.has('ECR-Z')).toBe(false);
    expect(map.get('ECR-A')).toEqual([]);
  });

  it('ne fait aucune requête pour une liste vide', async () => {
    expect(await listAttachmentsFor(db, [])).toEqual(new Map());
  });
});

describe('describeBlockers — regroupement pour l’UI (fonction pure)', () => {
  const depot: Attachment = { kind: 'depot', id: 'DEP-1', label: 'Avance territoire', from_depot_id: null };
  const fichier = (id: string, name: string, depotId: string | null): Attachment => ({
    kind: 'justificatif',
    id,
    label: name,
    from_depot_id: depotId,
  });

  it('regroupe les fichiers issus d’un dépôt SOUS ce dépôt, détachable', () => {
    const blockers = describeBlockers([depot, fichier('JUS-1', 'ficelle.jpg', 'DEP-1'), fichier('JUS-2', 'pain.jpg', 'DEP-1')]);

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'depot', id: 'DEP-1', detachable: true, file_count: 2 });
    expect(blockers[0].label).toContain('Avance territoire');
  });

  it('garde un justif uploadé en direct comme bloqueur à part, non détachable', () => {
    const blockers = describeBlockers([fichier('JUS-8', 'facture.pdf', null)]);

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'justificatif', id: 'JUS-8', detachable: false });
  });

  it('un fichier orphelin de dépôt (dépôt absent de la liste) reste un bloqueur visible', () => {
    const blockers = describeBlockers([fichier('JUS-1', 'ficelle.jpg', 'DEP-ABSENT')]);

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'justificatif', id: 'JUS-1', detachable: false });
  });

  it('marque remboursement, dépôt d’espèces et avance de camp comme non détachables', () => {
    const blockers = describeBlockers([
      { kind: 'remboursement', id: 'REMB-1', label: 'Camille Martin', from_depot_id: null },
      { kind: 'depot_especes', id: 'DEPE-1', label: 'Espèces 2026-07-01', from_depot_id: null },
      { kind: 'avance_camp', id: 'AVC-1', label: 'Chef Orange', from_depot_id: null },
    ]);

    expect(blockers).toHaveLength(3);
    expect(blockers.every((b) => !b.detachable)).toBe(true);
  });

  it('ne renvoie rien pour une liste vide', () => {
    expect(describeBlockers([])).toEqual([]);
  });
});
