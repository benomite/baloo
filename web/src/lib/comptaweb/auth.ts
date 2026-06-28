// Adapter Next : on lit process.env (peuplé par .env.local ou l'env Node)
// plutôt que le compta/.env du projet MCP.
// TODO : mutualiser avec compta/src/comptaweb-client/auth.ts via pnpm workspace.

import { performAutomatedLogin } from './auth-automated';
import { clearStoredSession, readStoredSession, writeStoredSession } from './session-store';
import { ComptawebSessionExpiredError } from './http';
import { resolveComptawebCredentials } from '../services/comptaweb-credentials';
import type { ComptawebConfig } from './types';

const DEFAULT_BASE_URL = 'https://sgdf.production.sirom.net';

export async function loadConfig(): Promise<ComptawebConfig> {
  const envBaseUrl = process.env.COMPTAWEB_BASE_URL ?? DEFAULT_BASE_URL;

  const stored = readStoredSession();
  if (stored) return { baseUrl: envBaseUrl, cookie: stored.cookieHeader };

  const creds = await resolveComptawebCredentials();
  if (creds) {
    const baseUrl = creds.baseUrl ?? DEFAULT_BASE_URL;
    const result = await performAutomatedLogin(creds.username, creds.password, { baseUrl });
    writeStoredSession({ cookieHeader: result.cookieHeader, capturedAt: result.capturedAt, username: creds.username });
    return { baseUrl, cookie: result.cookieHeader };
  }

  if (process.env.COMPTAWEB_COOKIE) {
    return { baseUrl: envBaseUrl, cookie: process.env.COMPTAWEB_COOKIE };
  }

  throw new Error(
    'Aucun identifiant Comptaweb. Configure-les dans /admin/parametres (ou COMPTAWEB_USERNAME + COMPTAWEB_PASSWORD).',
  );
}

export async function withAutoReLogin<T>(
  fn: (config: ComptawebConfig) => Promise<T>,
): Promise<T> {
  const config = await loadConfig();
  try {
    return await fn(config);
  } catch (err) {
    if (!(err instanceof ComptawebSessionExpiredError)) throw err;
    clearStoredSession();
    const fresh = await loadConfig();
    return fn(fresh);
  }
}
