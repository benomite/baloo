// Adapter Next : on lit process.env (peuplé par .env.local ou l'env Node)
// plutôt que le compta/.env du projet MCP.
// TODO : mutualiser avec compta/src/comptaweb-client/auth.ts via pnpm workspace.

import { performAutomatedLogin } from './auth-automated.js';
import { clearStoredSession, readStoredSession, writeStoredSession } from './session-store.js';
import { ComptawebSessionExpiredError } from './http.js';
import type { ComptawebConfig } from './types.js';

const DEFAULT_BASE_URL = 'https://sgdf.production.sirom.net';

export async function loadConfig(): Promise<ComptawebConfig> {
  const baseUrl = process.env.COMPTAWEB_BASE_URL ?? DEFAULT_BASE_URL;

  const stored = readStoredSession();
  if (stored) return { baseUrl, cookie: stored.cookieHeader };

  const username = process.env.COMPTAWEB_USERNAME;
  const password = process.env.COMPTAWEB_PASSWORD;
  if (username && password) {
    const result = await performAutomatedLogin(username, password, { baseUrl });
    writeStoredSession({ cookieHeader: result.cookieHeader, capturedAt: result.capturedAt, username });
    return { baseUrl, cookie: result.cookieHeader };
  }

  if (process.env.COMPTAWEB_COOKIE) {
    return { baseUrl, cookie: process.env.COMPTAWEB_COOKIE };
  }

  throw new Error(
    "Aucune session Comptaweb active. Renseigner COMPTAWEB_USERNAME + COMPTAWEB_PASSWORD dans web/.env.local (ou dans l'env Node du process).",
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
