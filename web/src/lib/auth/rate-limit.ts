import { getDb } from '../db';
import { ensureAuthSchema } from './schema';

// Rate limit sur l'envoi de magic links (par identifiant = email).
// Bornes : 1 envoi / 60s, 5 envois / heure. Dépassement = on jette
// silencieusement la demande côté serveur (cf. auth.ts) — le client
// affiche le même écran que pour un succès, pour ne pas leak l'info
// "cet email existe / a été récemment ciblé".
//
// Nettoyage opportuniste : on supprime les attempts > 24h à chaque
// check, ça suffit à empêcher la table de gonfler.

const SHORT_WINDOW_S = 60;
const SHORT_LIMIT = 1;
const LONG_WINDOW_S = 60 * 60;
const LONG_LIMIT = 5;
const RETENTION_S = 24 * 60 * 60;

export async function recordSigninAttempt(identifier: string): Promise<{ allowed: boolean }> {
  await ensureAuthSchema();
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();

  await db.prepare(
    "DELETE FROM signin_attempts WHERE attempted_at < datetime(?, ?)",
  ).run(nowIso, `-${RETENTION_S} seconds`);

  const shortFloor = new Date(now.getTime() - SHORT_WINDOW_S * 1000).toISOString();
  const longFloor = new Date(now.getTime() - LONG_WINDOW_S * 1000).toISOString();

  const counts = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN attempted_at >= ? THEN 1 ELSE 0 END) AS short_count,
         SUM(CASE WHEN attempted_at >= ? THEN 1 ELSE 0 END) AS long_count
       FROM signin_attempts
       WHERE identifier = ?`,
    )
    .get<{ short_count: number | null; long_count: number | null }>(shortFloor, longFloor, identifier);

  const shortCount = counts?.short_count ?? 0;
  const longCount = counts?.long_count ?? 0;
  if (shortCount >= SHORT_LIMIT || longCount >= LONG_LIMIT) {
    return { allowed: false };
  }

  await db
    .prepare('INSERT INTO signin_attempts (identifier, attempted_at) VALUES (?, ?)')
    .run(identifier, nowIso);

  return { allowed: true };
}
