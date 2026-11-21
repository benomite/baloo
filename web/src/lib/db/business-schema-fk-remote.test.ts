// #55 — la migration transfert interne doit passer sur libSQL distant, où
// `PRAGMA foreign_keys = OFF` envoyé dans un exec séparé n'a aucun effet sur
// l'instruction suivante : les clés étrangères restent actives et le
// `DROP TABLE ecritures` d'une reconstruction est refusé
// (« SQLITE_CONSTRAINT: FOREIGN KEY constraint failed »).
// On simule ce comportement en avalant ce PRAGMA, FK activées, tables
// référentes peuplées.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../db', async (orig) => ({
  ...(await orig<typeof import('../db')>()),
  getDb: () => holder.db,
}));

const FK_OFF = /PRAGMA\s+foreign_keys\s*=\s*(OFF|0)\s*;?/gi;

// DbWrapper qui se comporte comme libSQL distant : désactiver les FK est sans effet.
function distant(db: DbWrapper): DbWrapper {
  return {
    prepare: (sql) => db.prepare(sql.replace(FK_OFF, 'SELECT 1')),
    exec: (sql) => db.exec(sql.replace(FK_OFF, '')),
    pragma: (stmt) => (/^foreign_keys\s*=\s*(OFF|0)$/i.test(stmt.trim()) ? Promise.resolve([]) : db.pragma(stmt)),
    transaction: (fn) => db.transaction((tx) => fn(distant(tx))),
  };
}

const AVANT_51 = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('depense', 'recette')),
    category_id TEXT,
    mode_paiement_id TEXT,
    activite_id TEXT,
    carte_id TEXT,
    numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    comptaweb_ecriture_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
  );
  INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type) VALUES
    ('E1', 'g1', '2026-10-03', 'Versement', 25000, 'recette'),
    ('E2', 'g1', '2026-10-04', 'Achat', 1200, 'depense'),
    ('E3', 'g1', '2026-10-05', 'Remboursement', 800, 'depense');
  CREATE TABLE remboursements (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, demandeur TEXT NOT NULL, prenom TEXT, nom TEXT,
    email TEXT, rib_texte TEXT, rib_file_path TEXT, amount_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0, date_depense TEXT, nature TEXT, unite_id TEXT,
    justificatif_status TEXT NOT NULL DEFAULT 'en_attente', status TEXT NOT NULL DEFAULT 'a_traiter',
    motif_refus TEXT, date_paiement TEXT, mode_paiement_id TEXT, comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ecriture_id TEXT REFERENCES ecritures(id), notes TEXT, submitted_by_user_id TEXT,
    edit_token TEXT, validate_token TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
  );
  CREATE TABLE depots_especes (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_depot TEXT NOT NULL,
    total_amount_cents INTEGER NOT NULL, detail_billets TEXT,
    ecriture_id TEXT REFERENCES ecritures(id), airtable_id TEXT, notes TEXT, archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
  );
  CREATE TABLE depots_justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, submitted_by_user_id TEXT NOT NULL, titre TEXT NOT NULL,
    description TEXT, category_id TEXT, unite_id TEXT, amount_cents INTEGER, date_estimee TEXT, carte_id TEXT,
    statut TEXT NOT NULL DEFAULT 'a_traiter', ecriture_id TEXT REFERENCES ecritures(id),
    remboursement_id TEXT, motif_rejet TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
    updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
  );
  INSERT INTO remboursements (id, group_id, demandeur, ecriture_id) VALUES ('R1', 'g1', 'Alice', 'E3');
  INSERT INTO depots_especes (id, group_id, date_depot, total_amount_cents, ecriture_id) VALUES
    ('DE1', 'g1', '2026-10-03', 25000, 'E1'), ('DE2', 'g1', '2026-10-05', 800, 'E3');
  INSERT INTO depots_justificatifs (id, group_id, submitted_by_user_id, titre, ecriture_id) VALUES
    ('D1', 'g1', 'u1', 'Ticket', 'E1'), ('D2', 'g1', 'u1', 'Facture', 'E2');
`;

describe('ensureBusinessSchema sur libSQL distant, clés étrangères actives', () => {
  let brut: DbWrapper;

  beforeEach(async () => {
    vi.resetModules();
    brut = wrapClient(createClient({ url: 'file::memory:' }));
    await brut.exec(AVANT_51);
    await brut.exec('PRAGMA foreign_keys = ON');
    holder.db = distant(brut);
  });

  it('termine sans erreur de clé étrangère et ajoute le transfert interne', async () => {
    const { ensureBusinessSchema } = await import('./business-schema');
    await expect(ensureBusinessSchema()).resolves.toBeUndefined();

    const cols = (await brut.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>()).map((c) => c.name);
    expect(cols).toContain('mode_transfert');
    const fk = await brut.prepare('PRAGMA foreign_keys').get<{ foreign_keys: number }>();
    expect(fk?.foreign_keys).toBe(1);
  });
});
