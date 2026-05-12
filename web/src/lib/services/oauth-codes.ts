import { getDb } from '../db';
import { generateAuthorizationCode, hashOauthToken } from '../oauth/tokens';
import { verifyS256Pkce } from '../oauth/pkce';

const CODE_TTL_SECONDS = 120;

export interface IssueCodeInput {
  client_id: string;
  user_id: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  redirect_uri: string;
}

export async function issueAuthorizationCode(input: IssueCodeInput): Promise<string> {
  const { plain, hash } = generateAuthorizationCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();
  await getDb()
    .prepare(
      `INSERT INTO oauth_authorization_codes
       (code_hash, client_id, user_id, scope, code_challenge,
        code_challenge_method, redirect_uri, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hash,
      input.client_id,
      input.user_id,
      input.scope,
      input.code_challenge,
      input.code_challenge_method,
      input.redirect_uri,
      expiresAt,
    );
  return plain;
}

export class AuthorizationCodeError extends Error {
  constructor(public reason: 'invalid_grant' | 'invalid_request') {
    super(`OAuth code rejected: ${reason}`);
  }
}

export interface ConsumeCodeInput {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_verifier: string;
}

export interface ConsumeCodeResult {
  user_id: string;
  scope: string;
}

export async function consumeAuthorizationCode(input: ConsumeCodeInput): Promise<ConsumeCodeResult> {
  const hash = hashOauthToken(input.code);
  const db = getDb();
  const row = await db
    .prepare(
      `SELECT user_id, scope, client_id, redirect_uri, code_challenge,
              code_challenge_method, expires_at, used_at
       FROM oauth_authorization_codes WHERE code_hash = ?`,
    )
    .get<{
      user_id: string;
      scope: string;
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      code_challenge_method: string;
      expires_at: string;
      used_at: string | null;
    }>(hash);

  if (!row) throw new AuthorizationCodeError('invalid_grant');
  if (row.used_at) throw new AuthorizationCodeError('invalid_grant');
  if (new Date(row.expires_at).getTime() < Date.now())
    throw new AuthorizationCodeError('invalid_grant');
  if (row.client_id !== input.client_id) throw new AuthorizationCodeError('invalid_grant');
  if (row.redirect_uri !== input.redirect_uri) throw new AuthorizationCodeError('invalid_grant');
  if (row.code_challenge_method !== 'S256')
    throw new AuthorizationCodeError('invalid_request');
  if (!verifyS256Pkce(input.code_verifier, row.code_challenge))
    throw new AuthorizationCodeError('invalid_grant');

  // Single-use : marquer used_at avant retour.
  const result = await db
    .prepare(
      `UPDATE oauth_authorization_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE code_hash = ? AND used_at IS NULL`,
    )
    .run(hash);

  // Si changes === 0, c'est qu'un appel concurrent a deja
  // consomme le code entre notre SELECT et notre UPDATE. Rejeter.
  if (result.changes === 0) {
    throw new AuthorizationCodeError('invalid_grant');
  }

  return { user_id: row.user_id, scope: row.scope };
}
