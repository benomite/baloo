import { randomBytes } from 'crypto';
import type { DbWrapper } from '../db';
import { hashToken } from './api-tokens';

// Liens d'auto-connexion (chantier "lien accès direct remboursement").
//
// - Le token brut a la forme `inv_<base64url 32 bytes>`. Affiché une seule
//   fois à la génération (on ne stocke que le hash SHA-256).
// - Réutilisable jusqu'à expiration (7 j par défaut) — résiste aux robots
//   d'aperçu WhatsApp/iMessage qui visitent les liens.
// - Un seul lien actif par user : générer en révoque les précédents.
// - Révocable (revoked_at). Jamais de DELETE (cf. règle projet).

const INVITE_PREFIX = 'inv_';
const DEFAULT_TTL_DAYS = 7;

export interface GenerateInviteLinkInput {
  userId: string;
  groupId: string;
  callbackUrl: string;
  createdBy?: string | null;
  ttlDays?: number;
}

export interface GeneratedInviteLink {
  id: string;
  rawToken: string;
}

export async function generateInviteLink(
  db: DbWrapper,
  input: GenerateInviteLinkInput,
): Promise<GeneratedInviteLink> {
  // Un seul lien actif par user : révoque les précédents non révoqués.
  await db
    .prepare(
      `UPDATE invite_links
       SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .run(input.userId);

  const rawToken = INVITE_PREFIX + randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const id = `il-${randomBytes(8).toString('hex')}`;
  const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO invite_links
         (id, group_id, user_id, token_hash, callback_url, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.groupId,
      input.userId,
      tokenHash,
      input.callbackUrl,
      expiresAt,
      input.createdBy ?? null,
    );

  return { id, rawToken };
}

export interface ResolvedInviteLink {
  userId: string;
  groupId: string;
  callbackUrl: string;
}

export async function resolveInviteLink(
  db: DbWrapper,
  rawToken: string,
): Promise<ResolvedInviteLink | null> {
  const tokenHash = hashToken(rawToken);
  const row = await db
    .prepare(
      `SELECT l.user_id, l.group_id, l.callback_url, l.expires_at, l.revoked_at, u.statut
       FROM invite_links l
       JOIN users u ON u.id = l.user_id
       WHERE l.token_hash = ?`,
    )
    .get<{
      user_id: string;
      group_id: string;
      callback_url: string;
      expires_at: string;
      revoked_at: string | null;
      statut: string;
    }>(tokenHash);

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.statut !== 'actif') return null;
  if (new Date(row.expires_at) < new Date()) return null;

  return {
    userId: row.user_id,
    groupId: row.group_id,
    callbackUrl: row.callback_url,
  };
}

// Marque le user comme connecté au moins une fois (email_verified). N'écrase
// jamais une valeur existante. Idempotent.
export async function markUserConnected(db: DbWrapper, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET email_verified = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ? AND email_verified IS NULL`,
    )
    .run(userId);
}

export function buildInviteUrl(appUrl: string, rawToken: string): string {
  return `${appUrl.replace(/\/$/, '')}/i/${rawToken}`;
}
