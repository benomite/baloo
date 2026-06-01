import { getDb } from '../db';
import { currentTimestamp } from '../ids';
import { rejetPairKey, type SuggestionTargetKind } from '../queries/inbox-matching';

// Ré-exporté pour les call-sites historiques (inbox-auto).
export { rejetPairKey };

// Rejets de suggestions automatiques de l'inbox.
//
// Quand le trésorier voit une suggestion (paire écriture ↔ dépôt) qu'il
// sait fausse, il la « supprime » : on mémorise la paire ici pour ne
// plus jamais la re-proposer (ni en suggestion, ni en auto-link), sans
// toucher aux deux éléments eux-mêmes — ils restent orphelins et
// matchables manuellement avec autre chose.
//
// Table lazy-init (comme `depots_justificatifs`) : créée à la première
// utilisation, pas dans business-schema.ts.

let schemaEnsured = false;

export async function ensureInboxRejetsSchema(): Promise<void> {
  if (schemaEnsured) return;
  const db = getDb();

  // Forme cible : cible générique (depot | remboursement).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_suggestion_rejets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      ecriture_id TEXT NOT NULL REFERENCES ecritures(id),
      target_kind TEXT NOT NULL DEFAULT 'depot',
      target_id TEXT NOT NULL,
      rejected_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE (group_id, ecriture_id, target_kind, target_id)
    );
  `);

  // Migration des bases créées le 2026-06-01 avec l'ancienne forme
  // (depot_id NOT NULL, sans target_kind/target_id). SQLite ne permet
  // pas de relâcher NOT NULL -> recreate en préservant les lignes.
  const cols = await db
    .prepare(`PRAGMA table_info(inbox_suggestion_rejets)`)
    .all<{ name: string }>();
  const names = new Set(cols.map((c) => c.name));
  if (names.has('depot_id') && !names.has('target_kind')) {
    await db.exec(`
      CREATE TABLE inbox_suggestion_rejets_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL REFERENCES groupes(id),
        ecriture_id TEXT NOT NULL REFERENCES ecritures(id),
        target_kind TEXT NOT NULL DEFAULT 'depot',
        target_id TEXT NOT NULL,
        rejected_by_user_id TEXT REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE (group_id, ecriture_id, target_kind, target_id)
      );
      INSERT INTO inbox_suggestion_rejets_v2
        (group_id, ecriture_id, target_kind, target_id, rejected_by_user_id, created_at)
        SELECT group_id, ecriture_id, 'depot', depot_id, rejected_by_user_id, created_at
        FROM inbox_suggestion_rejets;
      DROP TABLE inbox_suggestion_rejets;
      ALTER TABLE inbox_suggestion_rejets_v2 RENAME TO inbox_suggestion_rejets;
    `);
  }

  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_inbox_rejets_group ON inbox_suggestion_rejets(group_id);`,
  );
  schemaEnsured = true;
}

// Enregistre le rejet d'une paire. Idempotent (UNIQUE + INSERT OR
// IGNORE) : re-rejeter la même paire ne lève pas.
export async function rejectSuggestion(
  ctx: { groupId: string; userId?: string | null },
  ecritureId: string,
  targetKind: SuggestionTargetKind,
  targetId: string,
): Promise<void> {
  await ensureInboxRejetsSchema();
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO inbox_suggestion_rejets
         (group_id, ecriture_id, target_kind, target_id, rejected_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(ctx.groupId, ecritureId, targetKind, targetId, ctx.userId ?? null, currentTimestamp());
}

// Charge l'ensemble des paires rejetées du groupe sous forme de Set de
// clés `rejetPairKey`, pour filtrer en mémoire les suggestions / auto-links.
export async function loadRejectedPairKeys(groupId: string): Promise<Set<string>> {
  await ensureInboxRejetsSchema();
  const rows = await getDb()
    .prepare(
      `SELECT ecriture_id, target_kind, target_id FROM inbox_suggestion_rejets WHERE group_id = ?`,
    )
    .all<{ ecriture_id: string; target_kind: string; target_id: string }>(groupId);
  return new Set(
    rows.map((r) =>
      rejetPairKey(r.ecriture_id, r.target_kind as SuggestionTargetKind, r.target_id),
    ),
  );
}
