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
// l'admin doit passer par une désactivation explicite (statut='inactif')
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
