// Assigne un rôle (et optionnellement un scope unité) à un user existant.
// Outil d'admin manuel pour activer un chef_unite ou un parent (chantier 5).
//
// Usage :
//   pnpm tsx scripts/set-user-role.ts <email> <role> [<unite_code>]
//
// Exemples :
//   pnpm tsx scripts/set-user-role.ts cheflj@example.fr chef_unite LJ
//   pnpm tsx scripts/set-user-role.ts parent@example.fr parent
//   pnpm tsx scripts/set-user-role.ts tres@example.fr tresorier
//
// Le user doit déjà exister en BDD (créé via le bootstrap ou le admin
// console SQL — l'auth refuse la création automatique au premier login).

import { ensureComptawebEnv } from '../src/lib/comptaweb/env-loader';
import { getDb } from '../src/lib/db';
import { currentTimestamp } from '../src/lib/ids';

ensureComptawebEnv();

const ALLOWED_ROLES = ['tresorier', 'cotresorier', 'chef_unite', 'parent'];

const [, , emailArg, roleArg, uniteCodeArg] = process.argv;

if (!emailArg || !roleArg) {
  console.error('Usage : pnpm tsx scripts/set-user-role.ts <email> <role> [<unite_code>]');
  console.error(`Rôles : ${ALLOWED_ROLES.join(', ')}`);
  process.exit(1);
}

if (!ALLOWED_ROLES.includes(roleArg)) {
  console.error(`Rôle invalide : ${roleArg}. Choisir parmi ${ALLOWED_ROLES.join(', ')}.`);
  process.exit(1);
}

const db = getDb();

const user = db
  .prepare('SELECT id, group_id, email, role, scope_unite_id FROM users WHERE email = ?')
  .get(emailArg) as { id: string; group_id: string; email: string; role: string | null; scope_unite_id: string | null } | undefined;

if (!user) {
  console.error(`User ${emailArg} introuvable. Le créer d'abord via 'pnpm bootstrap' ou en SQL.`);
  process.exit(1);
}

let scopeUniteId: string | null = null;
if (uniteCodeArg) {
  const unite = db
    .prepare('SELECT id, code, name FROM unites WHERE group_id = ? AND code = ?')
    .get(user.group_id, uniteCodeArg.toUpperCase()) as { id: string; code: string; name: string } | undefined;
  if (!unite) {
    console.error(`Unité avec code '${uniteCodeArg}' introuvable dans le groupe ${user.group_id}.`);
    const available = db.prepare('SELECT code, name FROM unites WHERE group_id = ? ORDER BY code').all(user.group_id) as Array<{ code: string; name: string }>;
    console.error('Codes disponibles : ' + available.map((u) => `${u.code} (${u.name})`).join(', '));
    process.exit(1);
  }
  scopeUniteId = unite.id;
}

if ((roleArg === 'tresorier' || roleArg === 'cotresorier') && uniteCodeArg) {
  console.error("Un trésorier n'a pas de scope unité. Ne pas passer d'unité pour ce rôle.");
  process.exit(1);
}

if (roleArg === 'chef_unite' && !uniteCodeArg) {
  console.error("Un chef_unite doit avoir un scope unité (3e argument).");
  process.exit(1);
}

db.prepare(
  'UPDATE users SET role = ?, scope_unite_id = ?, updated_at = ? WHERE id = ?',
).run(roleArg, scopeUniteId, currentTimestamp(), user.id);

console.log(`✓ User ${user.email} : rôle '${roleArg}'${scopeUniteId ? ` scopé sur ${uniteCodeArg.toUpperCase()}` : ''}.`);
console.log('  (Si le user était connecté, sa session reste valide — il faut qu\'il se reconnecte pour que le rôle prenne effet.)');
