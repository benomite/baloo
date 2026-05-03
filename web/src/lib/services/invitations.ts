import { getDb } from '../db';
import { currentTimestamp, uniqueId } from '../ids';
import { nullIfEmpty } from '../utils/form';
import { sendInvitationEmail } from '../email/invitation';

// Service d'invitation par email (chantier 0.2, ADR-020).
//
// Crée un user dans le groupe + envoie un email "bienvenue" qui pointe
// vers /login. Le user finalise sa connexion en saisissant son email sur
// /login (flow magic link standard Auth.js).
//
// L'absence de `email_verified` sur le user indique "pas encore connecté".

export interface InvitationContext {
  groupId: string;
  inviterUserId: string;
}

const VALID_ROLES = ['tresorier', 'RG', 'chef', 'equipier', 'parent'] as const;
export type InvitationRole = (typeof VALID_ROLES)[number];

export interface CreateInvitationInput {
  email: string;
  role: InvitationRole;
  scope_unite_id?: string | null;
  nom_affichage?: string | null;
  app_url: string;
}

export interface CreateInvitationResult {
  userId: string;
  email: string;
  role: string;
  scope_unite_id: string | null;
  email_sent: boolean;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function createInvitation(
  { groupId, inviterUserId }: InvitationContext,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();

  if (!VALID_ROLES.includes(input.role)) {
    throw new Error(`Rôle invalide : ${input.role}`);
  }

  // Cohérence rôle ↔ scope.
  const needsScope = input.role === 'chef';
  if (needsScope && !input.scope_unite_id) {
    throw new Error("Le rôle 'chef' nécessite une unité (scope_unite_id).");
  }
  if (!needsScope && input.scope_unite_id) {
    throw new Error(`Le rôle '${input.role}' n'a pas de scope unité.`);
  }

  // Anti-doublon dans le même groupe.
  const existing = await db
    .prepare('SELECT id FROM users WHERE group_id = ? AND email = ? LIMIT 1')
    .get<{ id: string }>(groupId, email);
  if (existing) {
    throw new Error(`Un user avec l'email ${email} existe déjà dans ce groupe.`);
  }

  // Validation du scope (l'unité doit exister dans le groupe).
  if (input.scope_unite_id) {
    const unite = await db
      .prepare('SELECT id FROM unites WHERE id = ? AND group_id = ? LIMIT 1')
      .get<{ id: string }>(input.scope_unite_id, groupId);
    if (!unite) throw new Error(`Unité ${input.scope_unite_id} introuvable dans ce groupe.`);
  }

  // Récupération du nom du groupe et de l'inviteur (pour le mail).
  const groupRow = await db
    .prepare('SELECT nom FROM groupes WHERE id = ?')
    .get<{ nom: string }>(groupId);
  const inviterRow = await db
    .prepare('SELECT nom_affichage FROM users WHERE id = ?')
    .get<{ nom_affichage: string | null }>(inviterUserId);

  // Création du user.
  const baseId = slugify(email.split('@')[0] || 'user');
  const id = await uniqueId('users', baseId);
  const now = currentTimestamp();
  const nomAffichage = input.nom_affichage?.trim() || email.split('@')[0];

  await db.prepare(
    `INSERT INTO users (id, group_id, person_id, email, nom_affichage, role, scope_unite_id, statut, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'actif', ?, ?)`,
  ).run(id, groupId, email, nomAffichage, input.role, nullIfEmpty(input.scope_unite_id), now, now);

  // Envoi du mail. Si ça échoue, on garde quand même le user créé — le
  // trésorier peut renvoyer un mail manuellement plus tard.
  let emailSent = false;
  try {
    await sendInvitationEmail({
      to: email,
      invitedName: nomAffichage,
      inviterName: inviterRow?.nom_affichage ?? null,
      groupName: groupRow?.nom ?? 'ton groupe SGDF',
      role: input.role,
      appUrl: input.app_url,
    });
    emailSent = true;
  } catch (err) {
    console.error(`[invitations] Envoi du mail à ${email} a échoué :`, err);
  }

  return {
    userId: id,
    email,
    role: input.role,
    scope_unite_id: input.scope_unite_id ?? null,
    email_sent: emailSent,
  };
}

export interface ListInvitationsItem {
  id: string;
  email: string;
  nom_affichage: string | null;
  role: string;
  scope_unite_id: string | null;
  unite_code: string | null;
  unite_name: string | null;
  created_at: string;
  email_verified: string | null;
}

// Liste les users du groupe qui ne se sont jamais connectés (email_verified
// IS NULL). Utile pour afficher la file d'attente d'invitations en cours.
export async function listPendingInvitations(
  { groupId }: { groupId: string },
): Promise<ListInvitationsItem[]> {
  return await getDb()
    .prepare(
      `SELECT u.id, u.email, u.nom_affichage, u.role, u.scope_unite_id,
              un.code AS unite_code, un.name AS unite_name,
              u.created_at, u.email_verified
       FROM users u
       LEFT JOIN unites un ON un.id = u.scope_unite_id
       WHERE u.group_id = ? AND u.statut = 'actif' AND u.email_verified IS NULL
       ORDER BY u.created_at DESC`,
    )
    .all<ListInvitationsItem>(groupId);
}

// Liste les users qui se sont déjà connectés au moins une fois
// (email_verified IS NOT NULL). C'est le vrai "annuaire actif" du
// groupe côté webapp.
export async function listActiveUsers(
  { groupId }: { groupId: string },
): Promise<ListInvitationsItem[]> {
  return await getDb()
    .prepare(
      `SELECT u.id, u.email, u.nom_affichage, u.role, u.scope_unite_id,
              un.code AS unite_code, un.name AS unite_name,
              u.created_at, u.email_verified
       FROM users u
       LEFT JOIN unites un ON un.id = u.scope_unite_id
       WHERE u.group_id = ? AND u.statut = 'actif' AND u.email_verified IS NOT NULL
       ORDER BY u.email_verified DESC`,
    )
    .all<ListInvitationsItem>(groupId);
}

// Renvoie un mail d'invitation à un user pending. Idempotent ; ne touche
// pas à la BDD (ne réinitialise rien). Échoue si le user n'existe pas
// dans le groupe ou s'il s'est déjà connecté (email_verified non null).
export async function resendInvitation(
  { groupId }: { groupId: string },
  { userId, app_url }: { userId: string; app_url: string },
): Promise<void> {
  const db = getDb();
  const user = await db
    .prepare(
      `SELECT u.email, u.nom_affichage, u.role, u.email_verified
       FROM users u
       WHERE u.id = ? AND u.group_id = ?`,
    )
    .get<{
      email: string;
      nom_affichage: string | null;
      role: string;
      email_verified: string | null;
    }>(userId, groupId);
  if (!user) throw new Error('User introuvable dans ce groupe.');
  if (user.email_verified) {
    throw new Error("Ce user s'est déjà connecté — pas besoin de réinviter.");
  }
  const groupRow = await db
    .prepare('SELECT nom FROM groupes WHERE id = ?')
    .get<{ nom: string }>(groupId);
  await sendInvitationEmail({
    to: user.email,
    invitedName: user.nom_affichage ?? user.email.split('@')[0],
    inviterName: null,
    groupName: groupRow?.nom ?? 'ton groupe SGDF',
    role: user.role as InvitationRole,
    appUrl: app_url,
  });
}

// Supprime un user pending (faute de frappe sur l'email, invitation
// périmée, etc.). Refuse si le user s'est déjà connecté — dans ce cas
// l'admin doit passer par une désactivation explicite (statut='ancien')
// pour préserver les références FK.
export async function deletePendingInvitation(
  { groupId }: { groupId: string },
  { userId }: { userId: string },
): Promise<void> {
  const db = getDb();
  const user = await db
    .prepare('SELECT email_verified FROM users WHERE id = ? AND group_id = ?')
    .get<{ email_verified: string | null }>(userId, groupId);
  if (!user) throw new Error('User introuvable dans ce groupe.');
  if (user.email_verified) {
    throw new Error(
      "Ce user s'est déjà connecté — suppression refusée pour préserver l'intégrité des données. Désactive-le plutôt.",
    );
  }
  await db.prepare('DELETE FROM users WHERE id = ? AND group_id = ?').run(userId, groupId);
}

// Liste les users désactivés du groupe (statut='ancien'). Utile pour
// les rouvrir en cas d'erreur ou de retour d'un membre.
export async function listInactiveUsers(
  { groupId }: { groupId: string },
): Promise<ListInvitationsItem[]> {
  return await getDb()
    .prepare(
      `SELECT u.id, u.email, u.nom_affichage, u.role, u.scope_unite_id,
              un.code AS unite_code, un.name AS unite_name,
              u.created_at, u.email_verified
       FROM users u
       LEFT JOIN unites un ON un.id = u.scope_unite_id
       WHERE u.group_id = ? AND u.statut = 'ancien'
       ORDER BY u.updated_at DESC`,
    )
    .all<ListInvitationsItem>(groupId);
}

// Modifie le rôle d'un user existant. Vérifie la cohérence rôle ↔ scope
// (le rôle 'chef' nécessite une unité, les autres non). Refuse de
// rétrograder le dernier trésorier actif du groupe (sinon plus personne
// pour gérer la compta).
export async function setUserRole(
  { groupId, currentUserId }: { groupId: string; currentUserId: string },
  { userId, role, scope_unite_id }: {
    userId: string;
    role: InvitationRole;
    scope_unite_id?: string | null;
  },
): Promise<void> {
  const db = getDb();

  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Rôle invalide : ${role}`);
  }

  const needsScope = role === 'chef';
  if (needsScope && !scope_unite_id) {
    throw new Error("Le rôle 'chef' nécessite une unité.");
  }
  if (!needsScope && scope_unite_id) {
    // On nettoie le scope automatiquement plutôt que d'erreur — l'admin
    // a juste laissé l'ancien scope en changeant de rôle.
    scope_unite_id = null;
  }

  const target = await db
    .prepare(
      `SELECT id, role, statut FROM users WHERE id = ? AND group_id = ? LIMIT 1`,
    )
    .get<{ id: string; role: string; statut: string }>(userId, groupId);
  if (!target) throw new Error('User introuvable dans ce groupe.');

  // Garde-fou : on ne rétrograde pas le dernier trésorier actif. Sinon
  // plus personne ne peut administrer.
  if (target.role === 'tresorier' && role !== 'tresorier') {
    const otherTresoriers = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM users
         WHERE group_id = ? AND statut = 'actif' AND role = 'tresorier' AND id != ?`,
      )
      .get<{ n: number }>(groupId, userId);
    if ((otherTresoriers?.n ?? 0) === 0) {
      throw new Error(
        "Impossible de rétrograder le dernier trésorier actif. Promeus d'abord quelqu'un d'autre.",
      );
    }
  }

  // Garde-fou bis : un admin ne peut pas se rétrograder lui-même
  // (sinon il perd ses droits dans la même requête et finit en
  // demi-cassé). Doit demander à un autre admin.
  if (userId === currentUserId && (role === 'chef' || role === 'equipier' || role === 'parent')) {
    throw new Error(
      'Tu ne peux pas te rétrograder toi-même — demande à un autre admin de le faire.',
    );
  }

  if (scope_unite_id) {
    const unite = await db
      .prepare('SELECT id FROM unites WHERE id = ? AND group_id = ? LIMIT 1')
      .get<{ id: string }>(scope_unite_id, groupId);
    if (!unite) throw new Error(`Unité ${scope_unite_id} introuvable dans ce groupe.`);
  }

  await db
    .prepare(
      `UPDATE users
       SET role = ?, scope_unite_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND group_id = ?`,
    )
    .run(role, scope_unite_id ?? null, userId, groupId);
}

// Désactive un user (statut='ancien'). Conserve les FK (signatures,
// remboursements soumis, etc.) — moins destructif qu'un DELETE. Refuse
// la désactivation du dernier trésorier actif et l'auto-désactivation.
export async function deactivateUser(
  { groupId, currentUserId }: { groupId: string; currentUserId: string },
  { userId }: { userId: string },
): Promise<void> {
  const db = getDb();
  if (userId === currentUserId) {
    throw new Error('Tu ne peux pas te désactiver toi-même.');
  }
  const target = await db
    .prepare('SELECT role FROM users WHERE id = ? AND group_id = ? AND statut = ? LIMIT 1')
    .get<{ role: string }>(userId, groupId, 'actif');
  if (!target) throw new Error('User introuvable ou déjà désactivé.');

  if (target.role === 'tresorier') {
    const otherTresoriers = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM users
         WHERE group_id = ? AND statut = 'actif' AND role = 'tresorier' AND id != ?`,
      )
      .get<{ n: number }>(groupId, userId);
    if ((otherTresoriers?.n ?? 0) === 0) {
      throw new Error('Impossible de désactiver le dernier trésorier actif.');
    }
  }

  await db
    .prepare(
      `UPDATE users
       SET statut = 'ancien', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND group_id = ?`,
    )
    .run(userId, groupId);
}

// Réactive un user désactivé (statut='actif').
export async function reactivateUser(
  { groupId }: { groupId: string },
  { userId }: { userId: string },
): Promise<void> {
  const db = getDb();
  await db
    .prepare(
      `UPDATE users
       SET statut = 'actif', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND group_id = ? AND statut = 'ancien'`,
    )
    .run(userId, groupId);
}
