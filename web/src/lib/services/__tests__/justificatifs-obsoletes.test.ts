// Retirer un justificatif devenu obsolète (mauvais fichier, version périmée)
// sans le détruire : `justificatifs` porte des données utilisateur, le projet
// interdit le DELETE dessus. On le marque obsolète — il disparaît des pièces
// actives, et le fichier reste consultable pour l'audit.
//
// Besoin terrain 2026-08-17 : un PDF de remboursement remplacé par une version
// corrigée, l'ancien restant affiché dans les pièces de la demande.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

vi.mock('../../ids', () => ({
  currentTimestamp: () => '2026-08-17T15:00:00Z',
  nextId: async (p: string) => `${p}-1`,
}));

import { marquerJustificatifObsolete, listJustificatifs } from '../justificatifs';

const SETUP_SQL = `
  CREATE TABLE justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL, mime_type TEXT,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    obsolete_at TEXT,
    uploaded_at TEXT NOT NULL DEFAULT '2026-08-01T00:00:00Z'
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  await db.exec(`
    INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id) VALUES
      ('JUS-1', 'g1', 'remboursement/RBT-1/vieux.pdf',  'vieux.pdf',  'remboursement', 'RBT-1'),
      ('JUS-2', 'g1', 'remboursement/RBT-1/bon.pdf',    'bon.pdf',    'remboursement', 'RBT-1'),
      ('JUS-3', 'g2', 'remboursement/RBT-9/autre.pdf',  'autre.pdf',  'remboursement', 'RBT-9');
  `);
  return db;
}

describe('marquerJustificatifObsolete', () => {
  let db: DbWrapper;
  beforeEach(async () => { db = await setupDb(); });

  it('retire le justificatif des pièces actives', async () => {
    await marquerJustificatifObsolete({ groupId: 'g1' }, 'JUS-1', db);

    const actifs = await listJustificatifs({ groupId: 'g1' }, { entity_id: 'RBT-1' }, db);
    expect(actifs.map((j) => j.id)).toEqual(['JUS-2']);
  });

  it('conserve la ligne en base (rien n’est supprimé)', async () => {
    await marquerJustificatifObsolete({ groupId: 'g1' }, 'JUS-1', db);

    const tous = await listJustificatifs({ groupId: 'g1' }, { entity_id: 'RBT-1', includeObsoletes: true }, db);
    expect(tous).toHaveLength(2);
    const vieux = tous.find((j) => j.id === 'JUS-1');
    expect(vieux?.obsolete_at).toBe('2026-08-17T15:00:00Z');
    expect(vieux?.file_path).toBe('remboursement/RBT-1/vieux.pdf');
  });

  it('refuse de toucher un justificatif d’un autre groupe', async () => {
    await expect(marquerJustificatifObsolete({ groupId: 'g1' }, 'JUS-3', db)).rejects.toThrow();
    expect(await listJustificatifs({ groupId: 'g2' }, { entity_id: 'RBT-9' }, db)).toHaveLength(1);
  });

  it('échoue clairement sur un identifiant inconnu', async () => {
    await expect(marquerJustificatifObsolete({ groupId: 'g1' }, 'JUS-404', db)).rejects.toThrow();
  });

  it('est idempotent : re-marquer ne change pas la date d’origine', async () => {
    await marquerJustificatifObsolete({ groupId: 'g1' }, 'JUS-1', db);
    await marquerJustificatifObsolete({ groupId: 'g1' }, 'JUS-1', db);

    const tous = await listJustificatifs({ groupId: 'g1' }, { entity_id: 'RBT-1', includeObsoletes: true }, db);
    expect(tous.find((j) => j.id === 'JUS-1')?.obsolete_at).toBe('2026-08-17T15:00:00Z');
  });
});
