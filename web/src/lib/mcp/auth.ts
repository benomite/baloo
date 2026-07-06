import { getDb } from '../db';
import { verifyAccessToken } from '../services/oauth-access-tokens';
import { loadUserUniteIds } from '../auth/user-unites';

export interface McpContext {
  userId: string;
  groupId: string;
  role: string;
  scopeUniteIds: string[];
  scope: string;
  clientId: string;
}

export async function verifyOauthAccessToken(rawToken: string): Promise<McpContext | null> {
  const tokenCtx = await verifyAccessToken(rawToken);
  if (!tokenCtx) return null;

  const db = getDb();
  const row = await db
    .prepare(
      `SELECT group_id, role
       FROM users WHERE id = ?`,
    )
    .get<{ group_id: string; role: string }>(tokenCtx.user_id);

  if (!row) return null;

  return {
    userId: tokenCtx.user_id,
    groupId: row.group_id,
    role: row.role,
    scopeUniteIds: await loadUserUniteIds(db, tokenCtx.user_id),
    scope: tokenCtx.scope,
    clientId: tokenCtx.client_id,
  };
}
