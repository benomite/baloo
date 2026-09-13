// Adapter Next : on lit process.env (peuplé par .env.local ou l'env Node)
// plutôt que le compta/.env du projet MCP.
// TODO : mutualiser avec compta/src/comptaweb-client/auth.ts via pnpm workspace.

import { performAutomatedLogin } from './auth-automated';
import { clearStoredSession, readStoredSession, writeStoredSession } from './session-store';
import { ComptawebSessionExpiredError } from './http';
import { assurerExercice } from './exercices';
import { resolveComptawebCredentials } from '../services/comptaweb-credentials';
import type { ComptawebConfig } from './types';

const DEFAULT_BASE_URL = 'https://comptaweb.sgdf.fr';

export async function loadConfig(): Promise<ComptawebConfig> {
  const envBaseUrl = process.env.COMPTAWEB_BASE_URL ?? DEFAULT_BASE_URL;

  const stored = readStoredSession('default');
  if (stored) return { baseUrl: envBaseUrl, cookie: stored.cookieHeader };

  const creds = await resolveComptawebCredentials();
  if (creds) {
    const baseUrl = creds.baseUrl ?? DEFAULT_BASE_URL;
    const result = await performAutomatedLogin(creds.username, creds.password, { baseUrl });
    writeStoredSession('default', {
      cookieHeader: result.cookieHeader,
      capturedAt: result.capturedAt,
      username: creds.username,
    });
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
    clearStoredSession('default');
    const fresh = await loadConfig();
    return fn(fresh);
  }
}

/** Ouvre (ou réutilise) la session dédiée à un exercice CW. */
export async function loadConfigPourExercice(cwId: number): Promise<ComptawebConfig> {
  const cle = String(cwId);
  const stored = readStoredSession(cle);
  const envBaseUrl = process.env.COMPTAWEB_BASE_URL ?? DEFAULT_BASE_URL;
  if (stored) return { baseUrl: envBaseUrl, cookie: stored.cookieHeader };

  const creds = await resolveComptawebCredentials();
  if (!creds) {
    throw new Error(
      'Aucun identifiant Comptaweb. Configure-les dans /admin/parametres (ou COMPTAWEB_USERNAME + COMPTAWEB_PASSWORD).',
    );
  }
  const baseUrl = creds.baseUrl ?? DEFAULT_BASE_URL;
  const result = await performAutomatedLogin(creds.username, creds.password, { baseUrl });
  const config = { baseUrl, cookie: result.cookieHeader };

  // Un login frais tombe sur l'exercice non clôturé : on bascule, puis on
  // confirme AVANT de mettre la session en cache. Une session en cache est donc
  // toujours une session dont l'exercice est prouvé.
  await assurerExercice(config, cwId);
  writeStoredSession(cle, {
    cookieHeader: result.cookieHeader,
    capturedAt: result.capturedAt,
    username: creds.username,
  });
  return config;
}

/** `withAutoReLogin`, mais sur la session d'un exercice donné. */
export async function withComptaweb<T>(
  cwId: number,
  fn: (config: ComptawebConfig) => Promise<T>,
): Promise<T> {
  const config = await loadConfigPourExercice(cwId);
  try {
    return await fn(config);
  } catch (err) {
    if (!(err instanceof ComptawebSessionExpiredError)) throw err;
    clearStoredSession(String(cwId));
    return fn(await loadConfigPourExercice(cwId));
  }
}
