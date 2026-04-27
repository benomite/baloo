import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db';
import { ensureAuthSchema } from './schema';

// API tokens long-vie pour clients programmatiques (MCP `baloo-compta`).
// Cf. ADR-014.
//
// - Le token brut a la forme `bal_<base64url 32 bytes>` (~43 chars utiles).
//   Affiché une seule fois à la génération.
// - On stocke en BDD le hash SHA-256 hex (`token_hash`).
// - Vérification : SHA-256 du token reçu → lookup → check expiration et
//   révocation → return user_id + group_id.

const TOKEN_PREFIX = 'bal_';

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface CreatedApiToken {
  id: string;
  rawToken: string;
  userId: string;
  name: string;
}

export async function createApiToken(opts: {
  userId: string;
  name: string;
  expiresAt?: Date | null;
}): Promise<CreatedApiToken> {
  await ensureAuthSchema();
  const rawToken = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const id = `tok-${randomBytes(8).toString('hex')}`;
  await getDb()
    .prepare(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, opts.userId, opts.name, tokenHash, opts.expiresAt ? opts.expiresAt.toISOString() : null);
  return { id, rawToken, userId: opts.userId, name: opts.name };
}

export interface ApiTokenContext {
  userId: string;
  groupId: string;
  role: string;
  scopeUniteId: string | null;
}

// Vérifie un token Bearer. Renvoie le contexte user+group si valide, sinon
// null. Met à jour `last_used_at` au passage (best-effort).
export async function verifyApiToken(rawToken: string): Promise<ApiTokenContext | null> {
  await ensureAuthSchema();
  const tokenHash = hashToken(rawToken);
  const db = getDb();

  const row = await db
    .prepare(
      `SELECT t.id, t.user_id, t.expires_at, t.revoked_at,
              u.group_id, u.statut, u.role, u.scope_unite_id
       FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
    )
    .get<{
      id: string;
      user_id: string;
      expires_at: string | null;
      revoked_at: string | null;
      group_id: string;
      statut: string;
      role: string | null;
      scope_unite_id: string | null;
    }>(tokenHash);

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.statut !== 'actif') return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // Best-effort, pas critique si ça échoue.
  try {
    await db.prepare(
      "UPDATE api_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
    ).run(row.id);
  } catch {
    /* ignore */
  }

  return {
    userId: row.user_id,
    groupId: row.group_id,
    role: row.role ?? 'tresorier',
    scopeUniteId: row.scope_unite_id,
  };
}
