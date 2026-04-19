import { loadEnv } from '../config.js';
import { performAutomatedLogin } from './auth-automated.js';
import { clearStoredSession, readStoredSession, writeStoredSession } from './session-store.js';
import { ComptawebSessionExpiredError } from './http.js';
import type { ComptawebConfig } from './types.js';

const DEFAULT_BASE_URL = 'https://sgdf.production.sirom.net';

export async function loadConfig(): Promise<ComptawebConfig> {
  const env = loadEnv();
  const baseUrl = env.COMPTAWEB_BASE_URL ?? DEFAULT_BASE_URL;

  // 1. Session persistée récente (< 8h) issue d'un login automatisé.
  const stored = readStoredSession();
  if (stored) {
    return { baseUrl, cookie: stored.cookieHeader };
  }

  // 2. Auth automatisée à partir des credentials Keycloak — chemin par défaut.
  const username = env.COMPTAWEB_USERNAME;
  const password = env.COMPTAWEB_PASSWORD;
  if (username && password) {
    const result = await performAutomatedLogin(username, password, { baseUrl });
    writeStoredSession({ cookieHeader: result.cookieHeader, capturedAt: result.capturedAt, username });
    return { baseUrl, cookie: result.cookieHeader };
  }

  // 3. Fallback de dépannage : cookie copié manuellement depuis le navigateur.
  if (env.COMPTAWEB_COOKIE) {
    return { baseUrl, cookie: env.COMPTAWEB_COOKIE };
  }

  throw new Error(
    "Aucune session Comptaweb active. Renseigner COMPTAWEB_USERNAME + COMPTAWEB_PASSWORD dans compta/.env (cf. compta/.env.example).",
  );
}

export async function forceReLogin(): Promise<ComptawebConfig> {
  const env = loadEnv();
  const baseUrl = env.COMPTAWEB_BASE_URL ?? DEFAULT_BASE_URL;
  const username = env.COMPTAWEB_USERNAME;
  const password = env.COMPTAWEB_PASSWORD;
  if (!username || !password) {
    throw new Error("Impossible de relancer le login : COMPTAWEB_USERNAME/PASSWORD manquants.");
  }
  const result = await performAutomatedLogin(username, password, { baseUrl });
  writeStoredSession({ cookieHeader: result.cookieHeader, capturedAt: result.capturedAt, username });
  return { baseUrl, cookie: result.cookieHeader };
}

// Helper : rejoue la fonction après un re-login silencieux si une
// ComptawebSessionExpiredError est levée. Utile pour les appels MCP qui
// doivent continuer à fonctionner quand la session serveur a expiré sans
// que le fichier data/comptaweb-session.json n'ait passé son TTL.
export async function withAutoReLogin<T>(
  fn: (config: ComptawebConfig) => Promise<T>,
): Promise<T> {
  const config = await loadConfig();
  try {
    return await fn(config);
  } catch (err) {
    if (!(err instanceof ComptawebSessionExpiredError)) throw err;
    clearStoredSession();
    const fresh = await forceReLogin();
    return fn(fresh);
  }
}
