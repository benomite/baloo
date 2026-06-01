import { getDb } from '../db';
import { currentTimestamp } from '../ids';
import { rejetPairKey } from '../queries/inbox-matching';

// Ré-exporté pour les call-sites historiques (inbox-auto) qui importaient
// la clé depuis ce service.
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
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_suggestion_rejets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      ecriture_id TEXT NOT NULL REFERENCES ecritures(id),
      depot_id TEXT NOT NULL REFERENCES depots_justificatifs(id),
      rejected_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE (group_id, ecriture_id, depot_id)
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_rejets_group ON inbox_suggestion_rejets(group_id);
  `);
  schemaEnsured = true;
}

// Enregistre le rejet d'une paire. Idempotent (UNIQUE + INSERT OR
// IGNORE) : re-rejeter la même paire ne lève pas.
export async function rejectSuggestion(
  ctx: { groupId: string; userId?: string | null },
  ecritureId: string,
  depotId: string,
): Promise<void> {
  await ensureInboxRejetsSchema();
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO inbox_suggestion_rejets
         (group_id, ecriture_id, depot_id, rejected_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ctx.groupId, ecritureId, depotId, ctx.userId ?? null, currentTimestamp());
}

// Charge l'ensemble des paires rejetées du groupe sous forme de Set de
// clés `rejetPairKey`, pour filtrer en mémoire les suggestions / auto-links.
export async function loadRejectedPairKeys(groupId: string): Promise<Set<string>> {
  await ensureInboxRejetsSchema();
  const rows = await getDb()
    .prepare(
      `SELECT ecriture_id, depot_id FROM inbox_suggestion_rejets WHERE group_id = ?`,
    )
    .all<{ ecriture_id: string; depot_id: string }>(groupId);
  return new Set(rows.map((r) => rejetPairKey(r.ecriture_id, r.depot_id)));
}
