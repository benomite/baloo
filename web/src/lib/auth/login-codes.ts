import { randomInt, randomBytes } from 'crypto';
import type { DbWrapper } from '../db';
import { hashToken } from './api-tokens';

// Codes de connexion à usage unique (OTP) — complément du magic link pour
// les PWA installées (Android/iOS) où le lien s'ouvre dans un autre
// navigateur que celui qui héberge l'app, donc dans un conteneur de
// cookies isolé. Le code, lui, se saisit DANS la PWA → la session se pose
// dans le bon conteneur.
//
// Sécurité :
// - Code à 6 chiffres, stocké HASHÉ (SHA-256 salé par l'email, comme les
//   autres tokens — cf. api-tokens / invite-links). Jamais en clair.
// - TTL court (30 min, aligné sur le magic link).
// - Anti-bruteforce en ligne : max 5 tentatives ratées par code, puis
//   blocage (le débit d'envoi est déjà borné par rate-limit.ts).
// - Un seul code actif par email : en générer un invalide les précédents.
// - Jamais de DELETE : on marque `consumed_at` (règle projet).

const CODE_TTL_MINUTES = 30;
const MAX_ATTEMPTS = 5;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Sel léger par email : empêche une table arc-en-ciel partagée entre
// emails si la BDD fuite (le faible espace 10^6 reste protégé en ligne
// par MAX_ATTEMPTS + TTL).
function hashCode(code: string, email: string): string {
  return hashToken(`${code}:${email}`);
}

export function generateCode(): string {
  // randomInt est cryptographiquement sûr (CSPRNG). 6 chiffres, paddés.
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export interface CreatedLoginCode {
  code: string; // brut — à mettre dans le mail, jamais persisté en clair
}

export async function createLoginCode(
  db: DbWrapper,
  email: string,
  opts: { ttlMinutes?: number } = {},
): Promise<CreatedLoginCode> {
  const normalized = normalizeEmail(email);

  // Un seul code actif par email : consomme les précédents non consommés.
  await db
    .prepare(
      `UPDATE login_codes
       SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE email = ? AND consumed_at IS NULL`,
    )
    .run(normalized);

  const code = generateCode();
  const id = `lc-${randomBytes(8).toString('hex')}`;
  const ttlMinutes = opts.ttlMinutes ?? CODE_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  await db
    .prepare(
      `INSERT INTO login_codes (id, email, code_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(id, normalized, hashCode(code, normalized), expiresAt);

  return { code };
}

export type VerifyLoginCodeResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' };

export async function verifyLoginCode(
  db: DbWrapper,
  email: string,
  code: string,
): Promise<VerifyLoginCodeResult> {
  const normalized = normalizeEmail(email);
  const codeClean = code.trim();

  const row = await db
    .prepare(
      `SELECT id, code_hash, expires_at, attempts
       FROM login_codes
       WHERE email = ? AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get<{ id: string; code_hash: string; expires_at: string; attempts: number }>(normalized);

  if (!row) return { ok: false, reason: 'invalid' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' };

  if (hashCode(codeClean, normalized) !== row.code_hash) {
    await db
      .prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?')
      .run(row.id);
    return { ok: false, reason: 'invalid' };
  }

  // Succès → consommation immédiate (usage unique).
  await db
    .prepare(
      `UPDATE login_codes
       SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    )
    .run(row.id);

  return { ok: true, email: normalized };
}
