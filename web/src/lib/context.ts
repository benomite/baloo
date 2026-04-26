import { redirect } from 'next/navigation';
import { auth } from './auth/auth';
import { getDb } from './db';

// Contexte courant côté serveur web (chantier 4, ADR-014).
//
// La session vient d'Auth.js (cookie). Pas de session → redirect vers /login.
// On résout le `group_id` du user via la table `users`.
//
// Important : c'est utilisé par les server components, server actions et
// shims `queries|actions/`. Pour les route handlers `/api/*`, voir
// `requireApiContext` dans `lib/api/route-helpers.ts` qui supporte aussi
// le Bearer token MCP.

export interface CurrentContext {
  userId: string;
  groupId: string;
  email: string;
  name: string | null;
}

export async function getCurrentContext(): Promise<CurrentContext> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const row = getDb()
    .prepare(
      "SELECT id, email, nom_affichage AS name, group_id FROM users WHERE id = ? AND statut = 'actif'",
    )
    .get(session.user.id) as { id: string; email: string; name: string | null; group_id: string } | undefined;

  if (!row) {
    redirect('/login');
  }

  return {
    userId: row.id,
    groupId: row.group_id,
    email: row.email,
    name: row.name,
  };
}
