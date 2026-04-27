import { redirect } from 'next/navigation';
import { auth } from './auth/auth';
import { getDb } from './db';

// Contexte courant côté serveur web (chantier 4, ADR-016).
//
// La session vient d'Auth.js (cookie). Pas de session → redirect vers /login.
// On résout le user complet (group_id, role, scope_unite_id) via la table
// `users`. Le rôle et le scope unitaire (chantier 5) servent à filtrer ce
// que voit un chef_unite ou un parent.
//
// Important : c'est utilisé par les server components, server actions et
// shims `queries|actions/`. Pour les route handlers `/api/*`, voir
// `requireApiContext` dans `lib/api/route-helpers.ts` qui supporte aussi
// le Bearer token MCP.

export type UserRole = 'tresorier' | 'cotresorier' | 'chef_unite' | 'parent' | string;

export interface CurrentContext {
  userId: string;
  groupId: string;
  email: string;
  name: string | null;
  role: UserRole;
  // ID de l'unité à laquelle l'accès du user est limité. NULL pour
  // tresorier/cotresorier (vue globale du groupe), renseigné pour
  // chef_unite / parent / chef_groupe scopés.
  scopeUniteId: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  group_id: string;
  role: string | null;
  scope_unite_id: string | null;
}

export async function getCurrentContext(): Promise<CurrentContext> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const row = await getDb()
    .prepare(
      "SELECT id, email, nom_affichage AS name, group_id, role, scope_unite_id FROM users WHERE id = ? AND statut = 'actif'",
    )
    .get<UserRow>(session.user.id);

  if (!row) {
    redirect('/login');
  }

  return {
    userId: row.id,
    groupId: row.group_id,
    email: row.email,
    name: row.name,
    role: row.role ?? 'tresorier',
    scopeUniteId: row.scope_unite_id,
  };
}
