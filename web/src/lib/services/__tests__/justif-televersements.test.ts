// Téléversement direct navigateur → Vercel Blob (ticket #28).
//
// Cas réel 2026-08-17 : un PDF de 12,8 Mo (`Rbst-frais-km-marin.pdf`) refusé,
// le body de la server action dépassant le plafond edge Vercel (~4,5 Mo).
// Le fichier ne transite plus par la fonction : ces tests couvrent ce que le
// serveur garde sous contrôle — la signature du token (type, taille,
// appartenance), l'inscription (callback en prod, repli serveur hors prod),
// l'accès privé et le rattachement unique.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

vi.mock('../../ids', () => {
  let n = 0;
  return {
    currentTimestamp: () => '2026-11-07T10:00:00Z',
    nextId: async (p: string) => `${p}-${++n}`,
  };
});

import {
  attachTeleversement,
  buildUploadTokenOptions,
  recordUploadCompleted,
  resolveTeleversements,
  televersementPrefix,
} from '../justif-televersements';
import { JustificatifValidationError } from '../justificatifs';
import { MAX_FILE_SIZE_BYTES } from '../../justif-allowed';

const ALICE = { groupId: 'g1', userId: 'u-alice' };
const BOB_MEME_GROUPE = { groupId: 'g1', userId: 'u-bob' };
const CAROL_AUTRE_GROUPE = { groupId: 'g2', userId: 'u-carol' };

const PDF_12_8_MO = Math.round(12.8 * 1024 * 1024);

const SETUP_SQL = `
  CREATE TABLE justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL, mime_type TEXT,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    obsolete_at TEXT,
    uploaded_at TEXT NOT NULL
  );
  CREATE TABLE justificatifs_televersements (
    pathname TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    justificatif_id TEXT,
    claimed_at TEXT,
    entity_type TEXT,
    entity_id TEXT
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return db;
}

function clientPayload(filename: string, size: number, contentType: string): string {
  return JSON.stringify({ filename, size, contentType });
}

const PRIVATE_URL = 'https://abc123.private.blob.vercel-storage.com/';
const PUBLIC_URL = 'https://abc123.public.blob.vercel-storage.com/';

describe('buildUploadTokenOptions — validation serveur avant signature', () => {
  const prefix = televersementPrefix(ALICE);

  it('signe un PDF de 12,8 Mo (le cas refusé le 2026-08-17)', () => {
    const opts = buildUploadTokenOptions(
      ALICE,
      `${prefix}Rbst-frais-km-marin.pdf`,
      clientPayload('Rbst-frais-km-marin.pdf', PDF_12_8_MO, 'application/pdf'),
    );
    expect(opts.maximumSizeInBytes).toBe(MAX_FILE_SIZE_BYTES);
    expect(opts.maximumSizeInBytes).toBeGreaterThan(PDF_12_8_MO);
    expect(opts.allowedContentTypes).toContain('application/pdf');
    expect(opts.allowOverwrite).toBe(false);
    // Le propriétaire voyage dans le token signé, pas dans une déclaration client.
    expect(JSON.parse(opts.tokenPayload)).toEqual({
      groupId: 'g1',
      userId: 'u-alice',
      filename: 'Rbst-frais-km-marin.pdf',
    });
  });

  it('refuse un type de fichier non autorisé, côté serveur', () => {
    expect(() =>
      buildUploadTokenOptions(ALICE, `${prefix}virus.exe`, clientPayload('virus.exe', 1000, 'application/pdf')),
    ).toThrow(JustificatifValidationError);
    expect(() =>
      buildUploadTokenOptions(
        ALICE,
        `${prefix}facture.pdf`,
        clientPayload('facture.pdf', 1000, 'application/x-msdownload'),
      ),
    ).toThrow(/MIME/);
  });

  it('ne laisse passer aucun type hors whitelist dans le token', () => {
    const opts = buildUploadTokenOptions(ALICE, `${prefix}a.pdf`, clientPayload('a.pdf', 10, 'application/pdf'));
    expect(opts.allowedContentTypes).not.toContain('application/x-msdownload');
    expect(opts.allowedContentTypes).not.toContain('text/html');
  });

  it('refuse un fichier au-delà de la limite', () => {
    expect(() =>
      buildUploadTokenOptions(
        ALICE,
        `${prefix}gros.pdf`,
        clientPayload('gros.pdf', MAX_FILE_SIZE_BYTES + 1, 'application/pdf'),
      ),
    ).toThrow(/trop volumineux/);
  });

  it('refuse de signer sur le groupe d’un autre', () => {
    const autreGroupe = `${televersementPrefix(CAROL_AUTRE_GROUPE)}facture.pdf`;
    expect(() =>
      buildUploadTokenOptions(ALICE, autreGroupe, clientPayload('facture.pdf', 10, 'application/pdf')),
    ).toThrow(/non autorisé/);
  });

  it('refuse de signer dans le dossier d’un autre membre du même groupe', () => {
    const autreUser = `${televersementPrefix(BOB_MEME_GROUPE)}facture.pdf`;
    expect(() =>
      buildUploadTokenOptions(ALICE, autreUser, clientPayload('facture.pdf', 10, 'application/pdf')),
    ).toThrow(/non autorisé/);
  });

  it('refuse un pathname qui remonte ou crée un sous-dossier', () => {
    for (const p of [`${prefix}../g2/x.pdf`, `${prefix}sous/x.pdf`, `${prefix}`]) {
      expect(() => buildUploadTokenOptions(ALICE, p, clientPayload('x.pdf', 10, 'application/pdf'))).toThrow(
        JustificatifValidationError,
      );
    }
  });

  it('refuse une demande sans payload exploitable', () => {
    expect(() => buildUploadTokenOptions(ALICE, `${prefix}x.pdf`, null)).toThrow(JustificatifValidationError);
    expect(() => buildUploadTokenOptions(ALICE, `${prefix}x.pdf`, '{oops')).toThrow(JustificatifValidationError);
  });
});

describe('recordUploadCompleted — callback onUploadCompleted (prod)', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  const tokenPayload = JSON.stringify({ groupId: 'g1', userId: 'u-alice', filename: 'Rbst-frais-km-marin.pdf' });
  const pathname = `${televersementPrefix(ALICE)}Rbst-frais-km-marin-x7Yz.pdf`;

  it('inscrit le téléversement avec le propriétaire du token', async () => {
    await recordUploadCompleted({ pathname, contentType: 'application/pdf', url: PRIVATE_URL + pathname }, tokenPayload, db);
    await recordUploadCompleted({ pathname, contentType: 'application/pdf', url: PRIVATE_URL + pathname }, tokenPayload, db);

    const rows = await db.prepare('SELECT * FROM justificatifs_televersements').all<Record<string, unknown>>();
    expect(rows).toHaveLength(1); // rejeu idempotent
    expect(rows[0]).toMatchObject({
      pathname,
      group_id: 'g1',
      user_id: 'u-alice',
      original_filename: 'Rbst-frais-km-marin.pdf',
      source: 'callback',
    });
  });

  it('refuse un blob public : les justificatifs restent privés', async () => {
    await expect(
      recordUploadCompleted({ pathname, contentType: 'application/pdf', url: PUBLIC_URL + pathname }, tokenPayload, db),
    ).rejects.toThrow(/privés/);
    const rows = await db.prepare('SELECT * FROM justificatifs_televersements').all();
    expect(rows).toHaveLength(0);
  });

  it('refuse un blob hors du préfixe du propriétaire du token', async () => {
    const ailleurs = `${televersementPrefix(CAROL_AUTRE_GROUPE)}x.pdf`;
    await expect(
      recordUploadCompleted({ pathname: ailleurs, contentType: 'application/pdf', url: PRIVATE_URL }, tokenPayload, db),
    ).rejects.toThrow(JustificatifValidationError);
  });
});

describe('resolveTeleversements + attachTeleversement — soumission du formulaire', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  const pathname = `${televersementPrefix(ALICE)}Rbst-frais-km-marin-x7Yz.pdf`;
  const ref = { pathname, filename: 'Rbst-frais-km-marin.pdf' };
  const headPrivate = async () => ({ size: PDF_12_8_MO, contentType: 'application/pdf', url: PRIVATE_URL + pathname });

  it('dev local sans callback : le serveur constate le fichier et l’enregistre', async () => {
    const head = vi.fn(headPrivate);
    const [tv] = await resolveTeleversements(ALICE, [ref], { db, head, isProduction: false });

    expect(head).toHaveBeenCalledWith(pathname);
    expect(tv).toMatchObject({ pathname, size_bytes: PDF_12_8_MO, source: 'serveur' });

    const justif = await attachTeleversement(ALICE, tv, { entity_type: 'remboursement', entity_id: 'RBT-1' }, db);
    expect(justif).toMatchObject({
      group_id: 'g1',
      file_path: pathname, // le blob déjà stocké, rien n'est recopié
      original_filename: 'Rbst-frais-km-marin.pdf',
      mime_type: 'application/pdf',
      entity_type: 'remboursement',
      entity_id: 'RBT-1',
    });
  });

  it('prod : utilise la ligne posée par le callback, sans repli serveur', async () => {
    await recordUploadCompleted(
      { pathname, contentType: 'application/pdf', url: PRIVATE_URL + pathname },
      JSON.stringify({ groupId: 'g1', userId: 'u-alice', filename: 'Rbst-frais-km-marin.pdf' }),
      db,
    );
    const head = vi.fn(headPrivate);
    const [tv] = await resolveTeleversements(ALICE, [ref], { db, head, isProduction: true });
    expect(tv.source).toBe('callback');
    expect(head).not.toHaveBeenCalled();
  });

  it('prod : attend un callback en retard sur le submit', async () => {
    const sleep = vi.fn(async () => {
      // Le callback arrive pendant l'attente.
      await recordUploadCompleted(
        { pathname, contentType: 'application/pdf', url: PRIVATE_URL + pathname },
        JSON.stringify({ groupId: 'g1', userId: 'u-alice', filename: 'Rbst-frais-km-marin.pdf' }),
        db,
      );
    });
    const [tv] = await resolveTeleversements(ALICE, [ref], { db, isProduction: true, sleep });
    expect(tv.source).toBe('callback');
  });

  it('prod : jamais de repli serveur — sans callback, la soumission est refusée', async () => {
    const head = vi.fn(headPrivate);
    await expect(
      resolveTeleversements(ALICE, [ref], { db, head, isProduction: true, sleep: async () => {}, callbackWaitMs: 1500 }),
    ).rejects.toThrow(/pas encore confirmé/);
    expect(head).not.toHaveBeenCalled();
  });

  it('un utilisateur ne peut pas rattacher le fichier d’un autre groupe', async () => {
    const autre = `${televersementPrefix(CAROL_AUTRE_GROUPE)}facture.pdf`;
    await expect(
      resolveTeleversements(ALICE, [{ pathname: autre, filename: 'facture.pdf' }], {
        db,
        head: headPrivate,
        isProduction: false,
      }),
    ).rejects.toThrow(/introuvable pour ton compte/);
  });

  it('ni celui d’un autre membre du même groupe', async () => {
    await resolveTeleversements(ALICE, [ref], { db, head: headPrivate, isProduction: false });
    await expect(
      resolveTeleversements(BOB_MEME_GROUPE, [ref], { db, head: headPrivate, isProduction: false }),
    ).rejects.toThrow(/introuvable pour ton compte/);
  });

  it('repli serveur : refuse un fichier absent du storage', async () => {
    await expect(
      resolveTeleversements(ALICE, [ref], { db, head: async () => null, isProduction: false }),
    ).rejects.toThrow(/introuvable dans le stockage/);
  });

  it('repli serveur : refuse un blob public', async () => {
    await expect(
      resolveTeleversements(ALICE, [ref], {
        db,
        head: async () => ({ size: 10, contentType: 'application/pdf', url: PUBLIC_URL + pathname }),
        isProduction: false,
      }),
    ).rejects.toThrow(/public/);
  });

  it('repli serveur : revalide type et taille réels du fichier stocké', async () => {
    await expect(
      resolveTeleversements(ALICE, [ref], {
        db,
        head: async () => ({ size: 10, contentType: 'text/html', url: PRIVATE_URL + pathname }),
        isProduction: false,
      }),
    ).rejects.toThrow(/MIME/);
  });

  it('un téléversement ne sert qu’une fois', async () => {
    const [tv] = await resolveTeleversements(ALICE, [ref], { db, head: headPrivate, isProduction: false });
    await attachTeleversement(ALICE, tv, { entity_type: 'depot', entity_id: 'DEP-1' }, db);

    await expect(
      resolveTeleversements(ALICE, [ref], { db, head: headPrivate, isProduction: false }),
    ).rejects.toThrow(/déjà rattaché/);
    await expect(
      attachTeleversement(ALICE, tv, { entity_type: 'depot', entity_id: 'DEP-2' }, db),
    ).rejects.toThrow(/déjà rattaché/);

    const justifs = await db.prepare('SELECT * FROM justificatifs').all();
    expect(justifs).toHaveLength(1);
  });
});
