import { randomBytes } from 'crypto';
import { getDb } from '../db';

export interface OauthClient {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
  last_used_at: string | null;
}

interface OauthClientRow {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string;
  created_at: string;
  last_used_at: string | null;
}

function rowToClient(row: OauthClientRow): OauthClient {
  return {
    ...row,
    redirect_uris: JSON.parse(row.redirect_uris) as string[],
  };
}

export interface RegisterClientInput {
  client_name: string;
  redirect_uris: string[];
}

export async function registerClient(input: RegisterClientInput): Promise<OauthClient> {
  const id = `cli_${randomBytes(8).toString('hex')}`;
  const client_id = randomBytes(16).toString('base64url');
  await getDb()
    .prepare(
      `INSERT INTO oauth_clients (id, client_id, client_name, redirect_uris)
       VALUES (?, ?, ?, ?)`,
    )
    .run(id, client_id, input.client_name, JSON.stringify(input.redirect_uris));
  return {
    id,
    client_id,
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    created_at: new Date().toISOString(),
    last_used_at: null,
  };
}

export async function findClientByClientId(clientId: string): Promise<OauthClient | null> {
  const row = await getDb()
    .prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`)
    .get<OauthClientRow>(clientId);
  return row ? rowToClient(row) : null;
}

export function validateRedirectUri(client: OauthClient, candidate: string): boolean {
  return client.redirect_uris.includes(candidate);
}

export async function touchLastUsed(clientId: string): Promise<void> {
  await getDb()
    .prepare(`UPDATE oauth_clients SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE client_id = ?`)
    .run(clientId);
}
