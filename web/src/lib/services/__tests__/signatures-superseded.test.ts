// Signatures rendues caduques par une édition : marquées périmées, JAMAIS
// supprimées (une chaîne de signatures est une preuve d'audit — et le projet
// interdit le DELETE sur les données utilisateur).
//
// Avant : `update.ts` faisait `DELETE FROM signatures ...` à chaque édition.
// La preuve disparaissait, et le statut de la demande continuait d'affirmer une
// validation que plus rien n'attestait (RBT-2026-030, 2026-08-17).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let clock = 0;
vi.mock('../../ids', () => ({
  currentTimestamp: () => `2026-08-17T12:0${clock++}:00Z`,
  nextId: async (p: string) => `${p}-1`,
}));

import { signDocument, listSignatures, supersedeSignatures, verifyChain } from '../signatures';

const SETUP_SQL = `
  CREATE TABLE signatures (
    id TEXT PRIMARY KEY, document_type TEXT NOT NULL, document_id TEXT NOT NULL,
    signer_role TEXT NOT NULL, signer_user_id TEXT, signer_email TEXT NOT NULL,
    signer_name TEXT, data_hash TEXT NOT NULL, previous_signature_id TEXT,
    chain_hash TEXT NOT NULL, ip TEXT, user_agent TEXT,
    server_timestamp TEXT NOT NULL, tsa_response TEXT, tsa_timestamp TEXT,
    superseded_at TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-08-17T12:00:00Z'
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP_SQL);
  return db;
}

const sign = (db: DbWrapper, role: 'demandeur' | 'tresorier' | 'RG', hash = 'HASH-V1') =>
  signDocument(
    {
      document_type: 'remboursement',
      document_id: 'RBT-1',
      signer_role: role,
      signer_email: `${role}@example.org`,
      data_hash: hash,
    },
    db,
  );

describe('signatures périmées', () => {
  let db: DbWrapper;
  beforeEach(async () => { clock = 0; db = await setupDb(); });

  it('ne renvoie que la chaîne courante après une supersession', async () => {
    await sign(db, 'demandeur');
    await sign(db, 'tresorier');
    await supersedeSignatures('remboursement', 'RBT-1', db);
    await sign(db, 'demandeur', 'HASH-V2');

    const actives = await listSignatures('remboursement', 'RBT-1', db);
    expect(actives.map((s) => s.signer_role)).toEqual(['demandeur']);
    expect(actives[0].data_hash).toBe('HASH-V2');
  });

  it('conserve les signatures périmées en base (rien n’est détruit)', async () => {
    await sign(db, 'demandeur');
    await sign(db, 'tresorier');
    await supersedeSignatures('remboursement', 'RBT-1', db);

    const toutes = await listSignatures('remboursement', 'RBT-1', db, { includeSuperseded: true });
    expect(toutes).toHaveLength(2);
    expect(toutes.every((s) => s.superseded_at !== null)).toBe(true);
  });

  it('repart d’une chaîne intègre : la nouvelle signature n’hérite pas des périmées', async () => {
    await sign(db, 'demandeur');
    await sign(db, 'tresorier');
    await supersedeSignatures('remboursement', 'RBT-1', db);
    const nouvelle = await sign(db, 'demandeur', 'HASH-V2');

    expect(nouvelle.previous_signature_id).toBeNull();
    await expect(verifyChain('remboursement', 'RBT-1', db)).resolves.toEqual({ ok: true });
  });

  it('n’écrase pas la date de péremption déjà posée', async () => {
    await sign(db, 'demandeur');
    await supersedeSignatures('remboursement', 'RBT-1', db);
    const premiere = (await listSignatures('remboursement', 'RBT-1', db, { includeSuperseded: true }))[0]
      .superseded_at;

    await sign(db, 'demandeur', 'HASH-V2');
    await supersedeSignatures('remboursement', 'RBT-1', db);

    const toutes = await listSignatures('remboursement', 'RBT-1', db, { includeSuperseded: true });
    expect(toutes).toHaveLength(2);
    expect(toutes[0].superseded_at).toBe(premiere);
  });

  it('ne touche pas les signatures d’un autre document', async () => {
    await sign(db, 'demandeur');
    await signDocument(
      {
        document_type: 'remboursement',
        document_id: 'RBT-2',
        signer_role: 'demandeur',
        signer_email: 'autre@example.org',
        data_hash: 'H2',
      },
      db,
    );
    await supersedeSignatures('remboursement', 'RBT-1', db);

    expect(await listSignatures('remboursement', 'RBT-2', db)).toHaveLength(1);
  });
});
