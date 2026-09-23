// Collecte des lignes d'une table selon son régime de sélection.
//
// Le modèle réel (tâche 6) est `parents: Jointure[]` en UNION, avec
// chaînage `via` quand le parent direct n'a pas lui-même de group_id — pas
// un `parent` singulier comme un ancien brouillon du cahier des charges
// pouvait le laisser penser. Les fixtures ci-dessous couvrent les deux cas :
// signatures (deux parents, pas de via) et remboursement_ligne_justificatifs
// (un parent, avec via sur deux crans).
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';
import { sqlPourTable, collecterTable } from '../collecte';
import type { TableExport } from '../tables';

let db: DbWrapper;

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, description TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE remboursements (
      id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT,
      rib_texte TEXT, edit_token TEXT
    );
    CREATE TABLE abandons_frais (id TEXT PRIMARY KEY, group_id TEXT, donateur TEXT);
    CREATE TABLE remboursement_lignes (id TEXT PRIMARY KEY, remboursement_id TEXT, libelle TEXT);
    CREATE TABLE remboursement_ligne_justificatifs (id TEXT PRIMARY KEY, ligne_id TEXT, fichier TEXT);
    CREATE TABLE signatures (id TEXT PRIMARY KEY, document_id TEXT, signataire TEXT);
  `);
  await db.prepare(`INSERT INTO ecritures VALUES ('E1', 'g', 'à nous'), ('E2', 'autre', 'pas à nous')`).run();
  await db.prepare(`INSERT INTO categories VALUES ('C1', 'Alimentation')`).run();
  await db
    .prepare(
      `INSERT INTO remboursements VALUES
        ('R1', 'g', 'Pierre', 'FR76 1234', 'tok_abc'),
        ('R2', 'autre', 'X', NULL, NULL)`,
    )
    .run();
  await db
    .prepare(`INSERT INTO abandons_frais VALUES ('A1', 'g', 'Julie'), ('A2', 'autre', 'Y')`)
    .run();
  await db
    .prepare(`INSERT INTO remboursement_lignes VALUES ('L1', 'R1', 'Essence'), ('L2', 'R2', 'Autre groupe')`)
    .run();
  await db
    .prepare(
      `INSERT INTO remboursement_ligne_justificatifs VALUES
        ('J1', 'L1', 'photo1.jpg'),
        ('J2', 'L2', 'photo2.jpg')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO signatures VALUES
        ('S1', 'R1', 'Pierre'),
        ('S2', 'A1', 'Julie'),
        ('S3', 'R2', 'X')`,
    )
    .run();
});

const remboursementLignesTable: TableExport = {
  nom: 'remboursement_lignes',
  regime: 'par_fk',
  parents: [{ table: 'remboursements', cleLocale: 'remboursement_id', cleParent: 'id' }],
};

const signaturesTable: TableExport = {
  nom: 'signatures',
  regime: 'par_fk',
  parents: [
    { table: 'remboursements', cleLocale: 'document_id', cleParent: 'id' },
    { table: 'abandons_frais', cleLocale: 'document_id', cleParent: 'id' },
  ],
};

const remboursementLigneJustificatifsTable: TableExport = {
  nom: 'remboursement_ligne_justificatifs',
  regime: 'par_fk',
  parents: [
    {
      table: 'remboursement_lignes',
      cleLocale: 'ligne_id',
      cleParent: 'id',
      via: { table: 'remboursements', cleLocale: 'remboursement_id', cleParent: 'id' },
    },
  ],
};

describe('collecterTable', () => {
  it('régime group_id : filtre sur le groupe, exclut les lignes des autres groupes', async () => {
    const rows = await collecterTable(db, 'g', { nom: 'ecritures', regime: 'group_id' });
    expect(rows.map((r) => r.id)).toEqual(['E1']);
  });

  it('régime global : exporte le référentiel en entier, sans filtre', async () => {
    const rows = await collecterTable(db, 'g', { nom: 'categories', regime: 'global' });
    expect(rows.map((r) => r.id)).toEqual(['C1']);
  });

  it('régime par_fk à un parent : borne par jointure, exclut la ligne dont le parent est d’un autre groupe', async () => {
    const rows = await collecterTable(db, 'g', remboursementLignesTable);
    expect(rows.map((r) => r.id)).toEqual(['L1']);
  });

  it('régime par_fk à deux parents (signatures) : union — rattachées à L’UN OU L’AUTRE ressortent', async () => {
    const rows = await collecterTable(db, 'g', signaturesTable);
    // S1 rattachée via remboursements, S2 via abandons_frais : les deux
    // parents doivent être pris en compte, pas seulement le premier.
    expect(rows.map((r) => r.id).sort()).toEqual(['S1', 'S2']);
  });

  it('un parent unique perdrait S2 : le test précédent doit couvrir les deux branches', async () => {
    // Filet de sécurité explicite sur la régression décrite dans le brief :
    // si l'implémentation ne gardait que parents[0], S2 (rattachée par
    // abandons_frais) disparaîtrait silencieusement.
    const rows = await collecterTable(db, 'g', signaturesTable);
    expect(rows.map((r) => r.id)).toContain('S2');
  });

  it('régime par_fk avec via : remonte deux crans jusqu’au parent qui porte group_id', async () => {
    const rows = await collecterTable(db, 'g', remboursementLigneJustificatifsTable);
    expect(rows.map((r) => r.id)).toEqual(['J1']);
  });

  it('ne caviarde pas par défaut (le dump doit être fidèle)', async () => {
    const rows = await collecterTable(db, 'g', { nom: 'remboursements', regime: 'group_id' });
    expect(rows[0].rib_texte).toBe('FR76 1234');
    expect(rows[0].edit_token).toBe('tok_abc');
  });

  it('caviarde sur demande (dossier d’exercice)', async () => {
    const rows = await collecterTable(
      db,
      'g',
      { nom: 'remboursements', regime: 'group_id' },
      { caviarder: true },
    );
    expect(rows[0]).not.toHaveProperty('rib_texte');
    expect(rows[0]).not.toHaveProperty('edit_token');
    expect(rows[0].demandeur).toBe('Pierre');
  });
});

describe('sqlPourTable', () => {
  it('refuse une table par_fk sans parents déclarés (undefined)', () => {
    expect(() => sqlPourTable({ nom: 'signatures', regime: 'par_fk' })).toThrow(/parent/);
  });

  it('refuse une table par_fk avec un tableau parents vide', () => {
    expect(() => sqlPourTable({ nom: 'signatures', regime: 'par_fk', parents: [] })).toThrow(/parent/);
  });

  it('génère un nombre de placeholders `?` égal au nombre de jointures liées', () => {
    // Erreur classique : un `via` sur deux crans ne doit générer qu'UN seul
    // `?` par branche (celui posé au niveau qui porte réellement group_id),
    // pas un par cran de chaînage.
    const un = sqlPourTable(remboursementLigneJustificatifsTable);
    expect((un.sql.match(/\?/g) ?? []).length).toBe(1);
    expect(un.args('g')).toEqual(['g']);

    const deux = sqlPourTable(signaturesTable);
    expect((deux.sql.match(/\?/g) ?? []).length).toBe(2);
    expect(deux.args('g')).toEqual(['g', 'g']);
  });

  it('le nombre d’arguments liés exécute sans erreur de binding (garde contre un mismatch args/placeholders)', async () => {
    // Si args() rendait un nombre d'arguments différent du nombre de `?`,
    // le driver lèverait une erreur de binding à l'exécution.
    await expect(collecterTable(db, 'g', signaturesTable)).resolves.not.toThrow();
  });
});
