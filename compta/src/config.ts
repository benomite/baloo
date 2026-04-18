import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPTA_ROOT = resolve(__dirname, '..');

function parseEnvFile(path: string): Record<string, string> {
  try {
    const raw = readFileSync(path, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

let cached: Record<string, string | undefined> | null = null;

export function loadEnv(): Record<string, string | undefined> {
  if (cached) return cached;
  const fileEnv = parseEnvFile(join(COMPTA_ROOT, '.env'));
  cached = { ...fileEnv, ...process.env };
  return cached;
}

export function requireEnv(key: string): string {
  const value = loadEnv()[key];
  if (!value) {
    throw new Error(`Variable ${key} manquante (voir compta/.env.example).`);
  }
  return value;
}
