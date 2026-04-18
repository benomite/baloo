import { loadEnv } from '../config.js';
import type { ComptawebConfig } from './types.js';

const DEFAULT_BASE_URL = 'https://sgdf.production.sirom.net';

export function loadConfig(): ComptawebConfig {
  const env = loadEnv();
  const cookie = env.COMPTAWEB_COOKIE;
  if (!cookie) {
    throw new Error(
      "COMPTAWEB_COOKIE introuvable. Copie le cookie de session depuis ton navigateur et place-le dans compta/.env (cf. compta/.env.example)."
    );
  }
  return {
    baseUrl: env.COMPTAWEB_BASE_URL ?? DEFAULT_BASE_URL,
    cookie,
  };
}
