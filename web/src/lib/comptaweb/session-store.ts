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

// TTL par défaut du cookie persisté côté client : 8h. Passé ce délai on re-joue
// un login automatisé même si le cookie n'a pas officiellement expiré côté serveur.
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

export interface StoredSession {
  cookieHeader: string;
  capturedAt: string;
  username?: string;
}

// Un fichier par clé de session. La clé est l'id CW de l'exercice (ADR-039) :
// une session Comptaweb ne voit qu'un exercice, donc deux exercices = deux
// cookies distincts. `default` sert aux appels non liés à un exercice précis.
function sessionFile(cle: string): string {
  const sain = cle.replace(/[^A-Za-z0-9_-]/g, '_');
  return resolve(DATA_DIR, `comptaweb-session-${sain}.json`);
}

export function readStoredSession(cle: string): StoredSession | null {
  const file = sessionFile(cle);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as StoredSession;
    if (!parsed.cookieHeader || !parsed.capturedAt) return null;
    const age = Date.now() - new Date(parsed.capturedAt).getTime();
    if (Number.isNaN(age) || age > DEFAULT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredSession(cle: string, session: StoredSession): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(sessionFile(cle), JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function clearStoredSession(cle: string): void {
  const file = sessionFile(cle);
  if (!existsSync(file)) return;
  try {
    writeFileSync(file, JSON.stringify({ cookieHeader: '', capturedAt: '' }, null, 2), { mode: 0o600 });
  } catch {
    // ignore
  }
}
