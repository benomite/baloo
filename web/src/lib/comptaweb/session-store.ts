import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sur Vercel le filesystem du déploiement (`/var/task/...`) est en
// lecture seule : seul `/tmp` est writable. Le cache de session
// Comptaweb est donc éphémère (perdu à chaque cold start), mais le
// cookie a un TTL de 8h et reste réutilisé tant que la lambda est
// chaude. En dev on garde `web/data/` versionné dans .gitignore.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VERCEL
  ? '/tmp'
  : resolve(__dirname, '..', '..', '..', 'data');
const SESSION_FILE = resolve(DATA_DIR, 'comptaweb-session.json');

// TTL par défaut du cookie persisté côté client : 8h. Passé ce délai on re-joue
// un login automatisé même si le cookie n'a pas officiellement expiré côté serveur.
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

export interface StoredSession {
  cookieHeader: string;
  capturedAt: string;
  username?: string;
}

export function readStoredSession(): StoredSession | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    const raw = readFileSync(SESSION_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.cookieHeader || !parsed.capturedAt) return null;
    const age = Date.now() - new Date(parsed.capturedAt).getTime();
    if (Number.isNaN(age) || age > DEFAULT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredSession(session: StoredSession): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function clearStoredSession(): void {
  if (!existsSync(SESSION_FILE)) return;
  try {
    writeFileSync(SESSION_FILE, JSON.stringify({ cookieHeader: '', capturedAt: '' }, null, 2), { mode: 0o600 });
  } catch {
    // ignore
  }
}
