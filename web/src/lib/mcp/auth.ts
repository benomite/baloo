import { getDb } from '../db';
import { verifyAccessToken } from '../services/oauth-access-tokens';

export interface McpContext {
  userId: string;
  groupId: string;
  role: string;
  scopeUniteId: string | null;
  scope: string;
  clientId: string;
}

export async function verifyOauthAccessToken(rawToken: string): Promise<McpContext | null> {
  const tokenCtx = await verifyAccessToken(rawToken);
  if (!tokenCtx) return null;

  const row = await getDb()
    .prepare(
      `SELECT group_id, role, scope_unite_id
       FROM users WHERE id = ?`,
    )
    .get<{ group_id: string; role: string; scope_unite_id: string | null }>(tokenCtx.user_id);

  if (!row) return null;

  return {
    userId: tokenCtx.user_id,
    groupId: row.group_id,
    role: row.role,
    scopeUniteId: row.scope_unite_id ?? null,
    scope: tokenCtx.scope,
    clientId: tokenCtx.client_id,
  };
}
