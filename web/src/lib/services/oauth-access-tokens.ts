import { getDb } from '../db';
import { generateAccessToken, hashOauthToken } from '../oauth/tokens';

const ACCESS_TOKEN_TTL_DAYS = 30;

export interface IssuedAccessToken {
  plain: string;
  expires_at: string;
}

export async function issueAccessToken(opts: {
  client_id: string;
  user_id: string;
  scope: string;
}): Promise<IssuedAccessToken> {
  const { plain, hash } = generateAccessToken();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_DAYS * 86400 * 1000).toISOString();
  await getDb()
    .prepare(
      `INSERT INTO oauth_access_tokens (token_hash, client_id, user_id, scope, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hash, opts.client_id, opts.user_id, opts.scope, expiresAt);
  return { plain, expires_at: expiresAt };
}

export interface AccessTokenContext {
  user_id: string;
  scope: string;
  client_id: string;
}

export async function verifyAccessToken(plain: string): Promise<AccessTokenContext | null> {
  const hash = hashOauthToken(plain);
  const db = getDb();
  const row = await db
    .prepare(
      `SELECT user_id, scope, client_id, expires_at, revoked_at
       FROM oauth_access_tokens WHERE token_hash = ?`,
    )
    .get<{
      user_id: string;
      scope: string;
      client_id: string;
      expires_at: string;
      revoked_at: string | null;
    }>(hash);

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  // Fire-and-forget : on n'attend pas l'update pour ne pas ralentir la verif.
  void db
    .prepare(
      `UPDATE oauth_access_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE token_hash = ?`,
    )
    .run(hash)
    .catch(() => {});

  return { user_id: row.user_id, scope: row.scope, client_id: row.client_id };
}

export async function revokeAccessToken(plain: string): Promise<void> {
  const hash = hashOauthToken(plain);
  await getDb()
    .prepare(
      `UPDATE oauth_access_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .run(hash);
}

export interface UserAccessToken {
  token_hash: string;
  client_id: string;
  client_name: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
}

export async function listActiveTokensForUser(userId: string): Promise<UserAccessToken[]> {
  const rows = await getDb()
    .prepare(
      `SELECT t.token_hash, t.client_id, c.client_name, t.scope,
              t.created_at, t.last_used_at, t.expires_at
       FROM oauth_access_tokens t
       JOIN oauth_clients c ON c.client_id = t.client_id
       WHERE t.user_id = ?
         AND t.revoked_at IS NULL
         AND t.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       ORDER BY t.created_at DESC`,
    )
    .all<UserAccessToken>(userId);
  return rows;
}

export async function revokeTokenByHash(userId: string, tokenHash: string): Promise<void> {
  await getDb()
    .prepare(
      `UPDATE oauth_access_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(tokenHash, userId);
}
