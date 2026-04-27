import type { Adapter, AdapterSession, AdapterUser } from 'next-auth/adapters';
import { getDb } from '../db';
import { ensureAuthSchema } from './schema';

// Adapter Auth.js custom pour le schéma Baloo (chantier 4, ADR-014).
//
// Choix :
// - Pas d'OAuth providers en P2 → on n'implémente PAS Account / linkAccount /
//   getUserByAccount (ils ne sont jamais appelés tant qu'on reste sur Email +
//   Credentials).
// - Restriction : seuls les users existants peuvent se connecter. La
//   création est donc gérée à part (script seed/CLI), pas via Auth.js.
//   `createUser` est implémenté pour rester compatible avec l'API mais lève
//   en pratique parce que le user doit pré-exister avec un rôle et un
//   group_id valides.

interface UserRow {
  id: string;
  email: string;
  nom_affichage: string | null;
  email_verified: string | null;
}

function toAdapterUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    email: row.email,
    name: row.nom_affichage,
    image: null,
    emailVerified: row.email_verified ? new Date(row.email_verified) : null,
  };
}

export const SqliteAdapter: Adapter = {
  async createUser(user) {
    await ensureAuthSchema();
    // Création non supportée via Auth.js — il manque group_id et role qui
    // sont des champs métier obligatoires.
    throw new Error(
      `Création de user via Auth.js refusée : ${user.email} doit être ajouté en BDD via le script de seed/admin avant de se connecter.`,
    );
  },

  async getUser(id) {
    await ensureAuthSchema();
    const row = await getDb()
      .prepare('SELECT id, email, nom_affichage, email_verified FROM users WHERE id = ?')
      .get<UserRow>(id);
    return row ? toAdapterUser(row) : null;
  },

  async getUserByEmail(email) {
    await ensureAuthSchema();
    const row = await getDb()
      .prepare(
        "SELECT id, email, nom_affichage, email_verified FROM users WHERE email = ? AND statut = 'actif' LIMIT 1",
      )
      .get<UserRow>(email);
    return row ? toAdapterUser(row) : null;
  },

  async updateUser(user) {
    await ensureAuthSchema();
    const db = getDb();
    const sets: string[] = [];
    const values: unknown[] = [];
    if (user.email !== undefined) { sets.push('email = ?'); values.push(user.email); }
    if (user.name !== undefined) { sets.push('nom_affichage = ?'); values.push(user.name); }
    if (user.emailVerified !== undefined) {
      sets.push('email_verified = ?');
      values.push(user.emailVerified ? user.emailVerified.toISOString() : null);
    }
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
    values.push(user.id);

    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    const row = await db
      .prepare('SELECT id, email, nom_affichage, email_verified FROM users WHERE id = ?')
      .get<UserRow>(user.id);
    return toAdapterUser(row!);
  },

  async createSession({ sessionToken, userId, expires }) {
    await ensureAuthSchema();
    await getDb()
      .prepare('INSERT INTO sessions (session_token, user_id, expires) VALUES (?, ?, ?)')
      .run(sessionToken, userId, expires.toISOString());
    return { sessionToken, userId, expires };
  },

  async getSessionAndUser(sessionToken) {
    await ensureAuthSchema();
    const db = getDb();
    const row = await db.prepare(
      `SELECT s.session_token, s.user_id, s.expires,
              u.id, u.email, u.nom_affichage, u.email_verified
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.session_token = ?`,
    ).get<{
      session_token: string;
      user_id: string;
      expires: string;
      id: string;
      email: string;
      nom_affichage: string | null;
      email_verified: string | null;
    }>(sessionToken);
    if (!row) return null;
    const session: AdapterSession = {
      sessionToken: row.session_token,
      userId: row.user_id,
      expires: new Date(row.expires),
    };
    const user = toAdapterUser({
      id: row.id,
      email: row.email,
      nom_affichage: row.nom_affichage,
      email_verified: row.email_verified,
    });
    return { session, user };
  },

  async updateSession(session) {
    await ensureAuthSchema();
    const db = getDb();
    const sets: string[] = [];
    const values: unknown[] = [];
    if (session.userId !== undefined) { sets.push('user_id = ?'); values.push(session.userId); }
    if (session.expires !== undefined) {
      sets.push('expires = ?');
      values.push(session.expires.toISOString());
    }
    if (sets.length === 0) return undefined;
    values.push(session.sessionToken);
    await db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE session_token = ?`).run(...values);
    const row = await db
      .prepare('SELECT session_token, user_id, expires FROM sessions WHERE session_token = ?')
      .get<{ session_token: string; user_id: string; expires: string }>(session.sessionToken);
    if (!row) return null;
    return {
      sessionToken: row.session_token,
      userId: row.user_id,
      expires: new Date(row.expires),
    };
  },

  async deleteSession(sessionToken) {
    await ensureAuthSchema();
    await getDb().prepare('DELETE FROM sessions WHERE session_token = ?').run(sessionToken);
  },

  async createVerificationToken(verificationToken) {
    await ensureAuthSchema();
    await getDb()
      .prepare('INSERT INTO verification_tokens (identifier, token, expires) VALUES (?, ?, ?)')
      .run(verificationToken.identifier, verificationToken.token, verificationToken.expires.toISOString());
    return verificationToken;
  },

  async useVerificationToken({ identifier, token }) {
    await ensureAuthSchema();
    const db = getDb();
    const row = await db
      .prepare('SELECT identifier, token, expires FROM verification_tokens WHERE identifier = ? AND token = ?')
      .get<{ identifier: string; token: string; expires: string }>(identifier, token);
    if (!row) return null;
    await db.prepare('DELETE FROM verification_tokens WHERE identifier = ? AND token = ?').run(identifier, token);
    return {
      identifier: row.identifier,
      token: row.token,
      expires: new Date(row.expires),
    };
  },
};
