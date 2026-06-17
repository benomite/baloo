# Rôle « membre », camps réservés aux chefs, home didactique — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fusionner `equipier`+`parent` en un rôle `membre` (3 process : dépôt/remboursement/abandon), réserver les camps aux chefs (leur unité) + admins, et remplacer la redirection d'accueil par une home didactique par rôle.

**Architecture:** Changements concentrés dans les gardes d'accès (`lib/auth/access.ts`), une migration BDD idempotente (`lib/auth/schema.ts`), la config de navigation (`nav-config.ts`), les références de rôles (context/invitations/email) et la home (`app/(app)/page.tsx`). Le filtrage par `scope_unite_id` (chef → sa seule unité) existe déjà dans les services et n'est pas touché.

**Tech Stack:** Next.js 16 (App Router, Server Components), Auth.js v5 (rôle dans `users.role`), libsql/Turso, Vitest.

---

## Contexte indispensable (à lire avant de coder)

- **Tout le code applicatif est dans `web/`.** Les chemins ci-dessous sont relatifs à `web/`. Commandes depuis `web/` ; si `pnpm` est capricieux, `npx` marche (`npx vitest run`, `npx tsc --noEmit`).
- **Lire `web/AGENTS.md`** : pas de CHECK SQL sur les rôles (validation en code, ADR-019) ; `force-dynamic` sur les pages qui lisent `auth()`/cookies ; jamais de DELETE sur données user.
- **Rôles aujourd'hui** : `tresorier`, `RG`, `chef`, `equipier`, `parent`. Cible : `tresorier`, `RG`, `chef`, `membre`.
- **Gardes** (`lib/auth/access.ts`) : `requireRole`, `requireAdmin`, `requireComptaAccess`, `requireCanSubmit`, `requireNotParent`. Pattern d'usage : `const ctx = await getCurrentContext(); requireX(ctx.role);` en tête de chaque page server.
- **Filet legacy** : pendant le court intervalle avant que la migration BDD ait tourné (cold start), un user peut encore avoir `role='equipier'`/`'parent'`. Les ensembles de rôles « submit » incluent ces valeurs comme alias de `membre` pour éviter tout lock-out. Les ensembles « camps » et « compta » ne les incluent PAS (on veut justement les en exclure — c'est l'état cible).
- **Pattern migration testable** (cf. `lib/db/business-schema-status-migration.test.ts` qui teste `migrateEcrituresStatus`) : on extrait la migration en fonction exportée prenant `db: DbWrapper`, appelée depuis `ensureAuthSchema`, et testée sur une BDD mémoire.
- **Pattern test DB** : `createClient({ url: 'file::memory:' })` + `wrapClient` (de `../db`) ; `db.prepare(sql).run()/.get<T>()/.all<T>()`.

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/auth/access.ts` *(modif)* | Constantes de rôles + `requireCampsAccess` ; suppression de `requireNotParent`. |
| `src/lib/auth/access.test.ts` *(create)* | Tests des gardes (fonctions pures). |
| `src/lib/auth/schema.ts` *(modif)* | `migrateLegacyRolesToMembre` exportée + appel dans `ensureAuthSchema`. |
| `src/lib/auth/role-migration.test.ts` *(create)* | Test de la migration. |
| `src/app/(app)/{remboursements,abandons,ecritures,camps}/page.tsx`, `camps/[id]/page.tsx`, `remboursements/nouveau/page.tsx` *(modif)* | Gardes mises à jour. |
| `src/components/layout/nav-config.ts` *(modif)* | Type `Role`, `MEMBERS`, camps réservés, suppression overrides parent. |
| `src/components/layout/nav-config.test.ts` *(modif)* | Tests nav mis à jour. |
| `src/lib/context.ts`, `src/lib/services/invitations.ts`, `src/lib/actions/invitations.ts`, `src/app/(app)/admin/invitations/page.tsx`, `src/lib/email/invitation.ts` *(modif)* | Références de rôles → `membre`. |
| `src/app/(app)/page.tsx` *(modif)* | Home didactique par rôle + cartes. |

---

## Task 1 : Gardes d'accès (`access.ts`) + tests

**Files:**
- Modify: `src/lib/auth/access.ts`
- Test: `src/lib/auth/access.test.ts` (create)

- [ ] **Step 1 : Écrire le test (échoue car symboles absents)**

Créer `src/lib/auth/access.test.ts`. NB : `requireRole` & co appellent `redirect()` de `next/navigation`, qui **lève** (throw) une erreur spéciale en runtime Next. On la mocke pour qu'elle throw une erreur identifiable, et on teste « autorisé = ne throw pas / refusé = throw ».

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// redirect() de Next lève en réalité ; on le simule par un throw repérable.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  requireAdmin,
  requireComptaAccess,
  requireCanSubmit,
  requireCampsAccess,
} from './access';

function allowed(fn: (r: string) => void, role: string): boolean {
  try {
    fn(role);
    return true;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('REDIRECT:')) return false;
    throw e;
  }
}

describe('access — requireCanSubmit (process : dépôt/rembs/abandon)', () => {
  it('autorise tresorier, RG, chef, membre', () => {
    for (const r of ['tresorier', 'RG', 'chef', 'membre']) {
      expect(allowed(requireCanSubmit, r)).toBe(true);
    }
  });
  it('autorise les alias legacy equipier/parent (avant migration)', () => {
    expect(allowed(requireCanSubmit, 'equipier')).toBe(true);
    expect(allowed(requireCanSubmit, 'parent')).toBe(true);
  });
  it('refuse un rôle inconnu', () => {
    expect(allowed(requireCanSubmit, 'inconnu')).toBe(false);
  });
});

describe('access — requireCampsAccess (chef + admin uniquement)', () => {
  it('autorise tresorier, RG, chef', () => {
    for (const r of ['tresorier', 'RG', 'chef']) {
      expect(allowed(requireCampsAccess, r)).toBe(true);
    }
  });
  it('refuse le membre (et les legacy equipier/parent)', () => {
    expect(allowed(requireCampsAccess, 'membre')).toBe(false);
    expect(allowed(requireCampsAccess, 'equipier')).toBe(false);
    expect(allowed(requireCampsAccess, 'parent')).toBe(false);
  });
});

describe('access — requireComptaAccess (sur /ecritures)', () => {
  it('autorise tresorier, RG, chef', () => {
    expect(allowed(requireComptaAccess, 'chef')).toBe(true);
  });
  it('refuse le membre', () => {
    expect(allowed(requireComptaAccess, 'membre')).toBe(false);
  });
});

describe('access — requireAdmin', () => {
  it('autorise tresorier/RG, refuse chef et membre', () => {
    expect(allowed(requireAdmin, 'tresorier')).toBe(true);
    expect(allowed(requireAdmin, 'chef')).toBe(false);
    expect(allowed(requireAdmin, 'membre')).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run: `cd web && npx vitest run src/lib/auth/access.test.ts`
Expected: FAIL — `requireCampsAccess` n'est pas exporté.

- [ ] **Step 3 : Mettre à jour `access.ts`**

Remplacer le contenu de `src/lib/auth/access.ts` par :

```ts
import { redirect } from 'next/navigation';

// Helpers d'autorisation par rôle (chantier 5, hiérarchie V2 : ADR-019 ;
// fusion equipier+parent → membre : spec 2026-06-17).
//
// La sidebar masque déjà les liens non pertinents, mais un user peut taper
// une URL : ces helpers protègent les pages côté serveur en redirigeant si
// le rôle ne matche pas. Le filtrage scope unité (chef) reste au niveau des
// services.

export const ADMIN_ROLES = ['tresorier', 'RG'] as const;
export const COMPTA_ROLES = ['tresorier', 'RG', 'chef'] as const;
// Camps : chef (sa seule unité, filtré côté service) + admin (tous).
export const CAMPS_ROLES = ['tresorier', 'RG', 'chef'] as const;
// Process (dépôt / remboursement / abandon). `membre` = rôle unifié.
// `equipier`/`parent` restent tolérés comme alias le temps que la migration
// BDD ait tourné partout (anti lock-out au cold start).
export const SUBMIT_ROLES = ['tresorier', 'RG', 'chef', 'membre', 'equipier', 'parent'] as const;

export function requireRole(currentRole: string, allowedRoles: readonly string[]): void {
  if (!allowedRoles.includes(currentRole)) {
    redirect('/');
  }
}

// `tresorier` ou `RG` : accès complet à l'admin.
export function requireAdmin(currentRole: string): void {
  requireRole(currentRole, ADMIN_ROLES);
}

// `tresorier`, `RG` ou `chef` : pages de compta (filtre scope unité appliqué
// au niveau des services pour `chef`). Posé aussi sur /ecritures.
export function requireComptaAccess(currentRole: string): void {
  requireRole(currentRole, COMPTA_ROLES);
}

// `tresorier`, `RG`, `chef` : accès aux camps (le service filtre le chef sur
// sa seule unité). Le membre n'a PAS accès aux camps.
export function requireCampsAccess(currentRole: string): void {
  requireRole(currentRole, CAMPS_ROLES);
}

// Peut soumettre (justifs, demandes de remboursement, abandons) :
// tresorier, RG, chef, membre.
export function requireCanSubmit(currentRole: string): void {
  requireRole(currentRole, SUBMIT_ROLES);
}
```

(NB : `requireNotParent` est supprimé. Ses appels sont remplacés en Task 3, qui suit immédiatement — entre les deux tasks la compilation des pages qui l'importent est cassée, c'est attendu et résolu en Task 3.)

- [ ] **Step 4 : Lancer le test (passe)**

Run: `cd web && npx vitest run src/lib/auth/access.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/auth/access.ts web/src/lib/auth/access.test.ts
git commit -m "feat(roles): access.ts — requireCampsAccess, membre dans SUBMIT_ROLES, drop requireNotParent"
```

---

## Task 2 : Migration BDD `equipier`/`parent` → `membre`

**Files:**
- Modify: `src/lib/auth/schema.ts`
- Test: `src/lib/auth/role-migration.test.ts` (create)

- [ ] **Step 1 : Écrire le test (échoue car fonction absente)**

Créer `src/lib/auth/role-migration.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { migrateLegacyRolesToMembre } from './schema';

const SETUP_SQL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    updated_at TEXT
  );
  INSERT INTO users (id, role) VALUES
    ('u1','equipier'),
    ('u2','parent'),
    ('u3','chef'),
    ('u4','tresorier'),
    ('u5','RG'),
    ('u6','membre');
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  return wrapClient(client);
}

describe('migrateLegacyRolesToMembre', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('convertit equipier et parent en membre, laisse les autres intacts', async () => {
    await migrateLegacyRolesToMembre(db);
    const rows = await db
      .prepare('SELECT id, role FROM users ORDER BY id')
      .all<{ id: string; role: string }>();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.role]));
    expect(byId).toEqual({
      u1: 'membre',
      u2: 'membre',
      u3: 'chef',
      u4: 'tresorier',
      u5: 'RG',
      u6: 'membre',
    });
  });

  it('est idempotent (2e passage ne change rien)', async () => {
    await migrateLegacyRolesToMembre(db);
    await migrateLegacyRolesToMembre(db);
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role IN ('equipier','parent')")
      .get<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run: `cd web && npx vitest run src/lib/auth/role-migration.test.ts`
Expected: FAIL — `migrateLegacyRolesToMembre` n'est pas exporté.

- [ ] **Step 3 : Ajouter la fonction + l'appel dans `schema.ts`**

Dans `src/lib/auth/schema.ts` :

(a) Ajouter l'import du type en tête si absent (le fichier importe déjà `getDb` ; ajouter le type `DbWrapper`) :

```ts
import { getDb, type DbWrapper } from '../db';
```
(Remplacer la ligne `import { getDb } from '../db';` existante par celle-ci.)

(b) Ajouter la fonction exportée (par exemple juste avant `export async function ensureAuthSchema`) :

```ts
// Fusion des rôles applicatifs equipier + parent → membre (spec 2026-06-17).
// Idempotent. Pas de DELETE. La validation des valeurs reste côté code.
export async function migrateLegacyRolesToMembre(db: DbWrapper): Promise<void> {
  await db.exec("UPDATE users SET role = 'membre' WHERE role IN ('equipier', 'parent')");
}
```

(c) L'appeler dans `ensureAuthSchema`, juste après les deux `UPDATE users SET role ...` existants (les lignes `UPDATE users SET role = 'tresorier' WHERE role = 'cotresorier'` et `... 'chef' WHERE role = 'chef_unite'`) :

```ts
  await migrateLegacyRolesToMembre(db);
```

- [ ] **Step 4 : Lancer le test (passe)**

Run: `cd web && npx vitest run src/lib/auth/role-migration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/auth/schema.ts web/src/lib/auth/role-migration.test.ts
git commit -m "feat(roles): migration BDD equipier/parent → membre (idempotente)"
```

---

## Task 3 : Mettre à jour les gardes des pages

**Files (Modify):**
- `src/app/(app)/remboursements/page.tsx`
- `src/app/(app)/remboursements/nouveau/page.tsx`
- `src/app/(app)/abandons/page.tsx`
- `src/app/(app)/ecritures/page.tsx`
- `src/app/(app)/camps/page.tsx`
- `src/app/(app)/camps/[id]/page.tsx`

But : remplacer `requireNotParent` (supprimé) par la garde adéquate, et ajouter une garde manquante sur le détail camp.

- [ ] **Step 1 : `remboursements/page.tsx` → requireCanSubmit**

Remplacer l'import `import { requireNotParent } from '@/lib/auth/access';` par `import { requireCanSubmit } from '@/lib/auth/access';` et l'appel `requireNotParent(ctx.role);` par `requireCanSubmit(ctx.role);`.

- [ ] **Step 2 : `abandons/page.tsx` → requireCanSubmit**

Idem : import `requireCanSubmit`, appel `requireCanSubmit(ctx.role);`.

- [ ] **Step 3 : `remboursements/nouveau/page.tsx` → requireCanSubmit**

Ce fichier ne fait pas `requireNotParent` mais `if (ctx.role === 'parent') redirect('/');` (vers la ligne 46). Remplacer cette ligne par un appel garde. Ajouter l'import `import { requireCanSubmit } from '@/lib/auth/access';` (à côté de l'import de `getCurrentContext`) et remplacer `if (ctx.role === 'parent') redirect('/');` par :

```ts
  requireCanSubmit(ctx.role);
```
Si l'import `redirect` de `next/navigation` n'est plus utilisé ailleurs dans le fichier après ça, le retirer (sinon le laisser).

- [ ] **Step 4 : `ecritures/page.tsx` → requireComptaAccess**

Remplacer l'import `import { requireNotParent } from '@/lib/auth/access';` par `import { requireComptaAccess } from '@/lib/auth/access';` et l'appel `requireNotParent(ctx.role);` par `requireComptaAccess(ctx.role);`.

- [ ] **Step 5 : `camps/page.tsx` → requireCampsAccess**

Remplacer l'import `import { requireNotParent } from '@/lib/auth/access';` par `import { requireCampsAccess } from '@/lib/auth/access';` et l'appel `requireNotParent(ctx.role);` par `requireCampsAccess(ctx.role);`.

- [ ] **Step 6 : `camps/[id]/page.tsx` → ajouter requireCampsAccess**

Ce fichier n'a actuellement AUCUNE garde de rôle (il s'appuie sur le scope du service). Ajouter la garde. Ajouter l'import :

```ts
import { requireCampsAccess } from '@/lib/auth/access';
```
Puis, juste après la résolution de `ctx` (la ligne `const [ctx, { id }, sp] = await Promise.all([...])`), ajouter :

```ts
  requireCampsAccess(ctx.role);
```

- [ ] **Step 7 : Vérifier qu'aucune référence à `requireNotParent` ne subsiste**

Run: `cd web && grep -rn "requireNotParent" src`
Expected: aucune sortie.

- [ ] **Step 8 : Compilation + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: compile OK ; tous les tests passent.

- [ ] **Step 9 : Commit**

```bash
git add "web/src/app/(app)/remboursements/page.tsx" "web/src/app/(app)/remboursements/nouveau/page.tsx" "web/src/app/(app)/abandons/page.tsx" "web/src/app/(app)/ecritures/page.tsx" "web/src/app/(app)/camps/page.tsx" "web/src/app/(app)/camps/[id]/page.tsx"
git commit -m "feat(roles): gardes pages — membre limité aux 3 process, camps chef+admin"
```

---

## Task 4 : Navigation (`nav-config.ts`) + tests

**Files:**
- Modify: `src/components/layout/nav-config.ts`
- Modify: `src/components/layout/nav-config.test.ts`

- [ ] **Step 1 : Mettre à jour `nav-config.ts`**

Dans `src/components/layout/nav-config.ts` :

(a) Type `Role` (ligne 7) → remplacer par :
```ts
export type Role = 'tresorier' | 'RG' | 'chef' | 'membre';
```

(b) Constantes (lignes 10-11) → remplacer par :
```ts
const ADMIN: Role[] = ['tresorier', 'RG'];
const MEMBERS: Role[] = ['tresorier', 'RG', 'chef', 'membre'];
const CAMPS: Role[] = ['tresorier', 'RG', 'chef'];
```

(c) Dans `DESKTOP_GROUPS` → groupe `process` : remplacer les 4 items par (Camps réservé `CAMPS`, plus d'override parent sur remboursements, `MEMBERS` au lieu de `SUBMITTERS`) :
```ts
    items: [
      { href: '/depot', adminHref: '/depots', label: 'Déposer', adminLabel: 'Dépôts', icon: Paperclip, roles: MEMBERS },
      { href: '/camps', label: 'Camps', icon: Tent, roles: CAMPS },
      { href: '/remboursements', label: 'Mes demandes', adminLabel: 'Remboursements', icon: HandCoins, roles: MEMBERS },
      { href: '/abandons', label: 'Abandons', icon: Gift, roles: MEMBERS },
    ],
```
(Note : on ajoute `roles: MEMBERS` sur l'item remboursements — avant il n'avait pas de `roles` donc visible par tous ; désormais le `parent` n'existe plus et on veut l'item visible pour les membres/chefs/admins, ce que `MEMBERS` couvre.)

(d) `resolveNavItem` (lignes 90-101) : retirer les branches `parent`. Remplacer par :
```ts
export function resolveNavItem(item: NavItem, role: string): ResolvedNavItem {
  const admin = isAdminRole(role);
  const href = admin && item.adminHref ? item.adminHref : item.href;
  const label = admin && item.adminLabel ? item.adminLabel : item.label;
  return { href, label, icon: item.icon };
}
```

(e) Interface `NavItem` : retirer les champs `parentHref` et `parentLabel` (lignes 24-29, les deux commentaires + propriétés `parentHref?` et `parentLabel?`). Garder `adminHref`/`adminLabel`.

(f) `MobileTab.key` type (ligne 104) : retirer `'recus'` → `key: 'depot' | 'demandes' | 'abandons' | 'plus';`.

(g) `MOBILE_TABS` (lignes 114-120) : supprimer la ligne `recus` et utiliser `MEMBERS` :
```ts
export const MOBILE_TABS: MobileTab[] = [
  { key: 'depot', href: '/depot', label: 'Déposer', icon: Paperclip, roles: MEMBERS },
  { key: 'demandes', href: '/remboursements', label: 'Demandes', icon: HandCoins, roles: MEMBERS },
  { key: 'abandons', href: '/abandons', label: 'Abandons', icon: Gift, roles: MEMBERS },
  { key: 'plus', href: '#plus', label: 'Plus', icon: Ellipsis, roles: ADMIN },
];
```

(h) L'import `FileText` (ligne 2) n'est plus utilisé (il servait au tab `recus`) → le retirer de la liste d'import lucide-react.

- [ ] **Step 2 : Mettre à jour `nav-config.test.ts`**

Remplacer le contenu des `describe` qui référencent `equipier`/`parent`/`recus` par les versions « membre ». Modifications précises :

- Test « le trésorier voit les 4 process… » : inchangé (le trésorier voit toujours `['/depot', '/camps', '/remboursements', '/abandons']`).
- Remplacer le test « le parent ne voit que Remboursements dans process » par :
```ts
  it('le membre voit Déposer/Demandes/Abandons mais PAS Camps', () => {
    const process = visibleItemsForRole(group('process').items, 'membre').map((i) => i.href);
    expect(process).toEqual(['/depot', '/remboursements', '/abandons']);
    expect(visibleItemsForRole(group('comptabilite').items, 'membre')).toHaveLength(0);
    expect(visibleItemsForRole(group('administration').items, 'membre')).toHaveLength(0);
  });
```
- Dans `describe('nav-config — resolveNavItem ...')` : remplacer les assertions `equipier`/`parent` par :
```ts
  it('Déposer pointe vers /depot avec le libellé "Déposer" pour un membre', () => {
    expect(resolveNavItem(depot, 'membre')).toMatchObject({ href: '/depot', label: 'Déposer' });
  });

  it('Remboursements : "Remboursements" pour admin, "Mes demandes" pour membre', () => {
    expect(resolveNavItem(rembs, 'RG').label).toBe('Remboursements');
    expect(resolveNavItem(rembs, 'membre').label).toBe('Mes demandes');
  });
```
- Dans `describe('nav-config — mobile')` : remplacer le test equipier et supprimer le test parent :
```ts
  it('le membre voit Déposer / Demandes / Abandons, sans Plus', () => {
    expect(visibleTabsForRole('membre').map((t) => t.key)).toEqual(['depot', 'demandes', 'abandons']);
  });
```
(supprimer le test « le parent voit seulement Mes reçus »).

- [ ] **Step 3 : Compilation + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run src/components/layout/nav-config.test.ts`
Expected: PASS.

- [ ] **Step 4 : Commit**

```bash
git add web/src/components/layout/nav-config.ts web/src/components/layout/nav-config.test.ts
git commit -m "feat(roles): nav — membre (3 process), camps réservés chef+admin, fin du parent"
```

---

## Task 5 : Références de rôles (hors home)

**Files (Modify):**
- `src/lib/context.ts`
- `src/lib/services/invitations.ts`
- `src/lib/actions/invitations.ts`
- `src/app/(app)/admin/invitations/page.tsx`
- `src/lib/email/invitation.ts`

But : remplacer partout `equipier`/`parent` par `membre` dans les listes de rôles et libellés. (La home `page.tsx` est traitée en Task 6.)

- [ ] **Step 1 : `context.ts` — type `UserRole`**

Remplacer la ligne (≈20) :
```ts
export type UserRole = 'tresorier' | 'RG' | 'chef' | 'equipier' | 'parent' | string;
```
par :
```ts
export type UserRole = 'tresorier' | 'RG' | 'chef' | 'membre' | string;
```

- [ ] **Step 2 : `services/invitations.ts` — VALID_ROLES**

Remplacer (≈ligne 19) :
```ts
const VALID_ROLES = ['tresorier', 'RG', 'chef', 'equipier', 'parent'] as const;
```
par :
```ts
const VALID_ROLES = ['tresorier', 'RG', 'chef', 'membre'] as const;
```

- [ ] **Step 3 : `actions/invitations.ts` — VALID_ROLES**

Remplacer (≈ligne 18) :
```ts
const VALID_ROLES: readonly InvitationRole[] = ['tresorier', 'RG', 'chef', 'equipier', 'parent'];
```
par :
```ts
const VALID_ROLES: readonly InvitationRole[] = ['tresorier', 'RG', 'chef', 'membre'];
```

- [ ] **Step 4 : `admin/invitations/page.tsx` — ROLE_OPTIONS**

Remplacer le tableau `ROLE_OPTIONS` (≈lignes 48-54) par (un seul rôle « membre » remplace équipier + parent) :
```ts
const ROLE_OPTIONS = [
  { value: 'membre', label: 'Membre (dépôt, remboursement, abandon)' },
  { value: 'chef', label: "Chef d'unité" },
  { value: 'tresorier', label: 'Trésorier' },
  { value: 'RG', label: 'Responsable de groupe' },
];
```

- [ ] **Step 5 : `email/invitation.ts` — ROLE_LABELS + ROLE_ACTIONS**

(a) Dans `ROLE_LABELS` (≈lignes 12-18) : retirer les clés `equipier` et `parent`, ajouter `membre` :
```ts
const ROLE_LABELS: Record<string, string> = {
  tresorier: 'trésorier',
  RG: 'responsable de groupe',
  chef: "chef d'unité",
  membre: 'membre',
};
```

(b) Dans `ROLE_ACTIONS` (objet `Record<string, Action[]>`) : renommer la clé `equipier` en `membre` et supprimer la clé `parent`. Le contenu des actions `equipier` (faire une demande de remboursement / déclarer un abandon / déposer un justif) devient celui de `membre`. La fonction `actionsFor` a un fallback `?? ROLE_ACTIONS.equipier` (≈ligne 91) → le remplacer par `?? ROLE_ACTIONS.membre`.

Concrètement, dans `ROLE_ACTIONS`, remplacer la clé `equipier: [...]` par `membre: [...]` (même tableau d'actions) et **supprimer** le bloc `parent: [...]`. Puis :
```ts
function actionsFor(role: string): Action[] {
  return ROLE_ACTIONS[role] ?? ROLE_ACTIONS.membre;
}
```

- [ ] **Step 6 : Compilation + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: compile OK ; tous les tests passent.

- [ ] **Step 7 : Commit**

```bash
git add web/src/lib/context.ts web/src/lib/services/invitations.ts web/src/lib/actions/invitations.ts "web/src/app/(app)/admin/invitations/page.tsx" web/src/lib/email/invitation.ts
git commit -m "feat(roles): références equipier/parent → membre (context, invitations, email)"
```

---

## Task 6 : Home didactique par rôle (`page.tsx`)

**Files:**
- Modify: `src/app/(app)/page.tsx`

But : ne plus rediriger chef/membre vers `/depot` ; rendre une home avec cartes-raccourcis (membre = 3, chef = 4 avec Camps) + « Mes dernières demandes ». Admin toujours redirigé `/ecritures`.

- [ ] **Step 1 : Routage + constantes**

Dans `src/app/(app)/page.tsx` :

(a) Ajouter `Tent` à l'import lucide-react (la ligne d'import en tête, à côté de `Paperclip`, `Gift`, etc.) :
```ts
import {
  ArrowRight,
  CircleHelp,
  Gift,
  HandCoins,
  Paperclip,
  Sparkles,
  Tent,
  X,
  type LucideIcon,
} from 'lucide-react';
```

(b) `ROLE_LABEL` (≈lignes 32-38) : retirer `equipier`/`parent`, ajouter `membre` :
```ts
const ROLE_LABEL: Record<string, string> = {
  tresorier: 'trésorier',
  RG: 'responsable de groupe',
  chef: "chef d'unité",
  membre: 'membre',
};
```

(c) `SUBMIT_ROLES` local (≈ligne 41) :
```ts
const SUBMIT_ROLES = ['tresorier', 'RG', 'chef', 'membre', 'equipier', 'parent'];
```

(d) Dans `HomePage`, remplacer le bloc de redirection (≈lignes 63-67) :
```ts
  // Admin → vue compta. chef + membre → home didactique (rendu ci-dessous).
  if (ADMIN_ROLES.includes(ctx.role)) redirect('/ecritures');

  const isChef = ctx.role === 'chef';
  const canSubmit = SUBMIT_ROLES.includes(ctx.role);
```
(supprimer la ligne `if (ctx.role !== 'parent') redirect('/depot');` et l'ancien `const canSubmit = ...` redondant plus bas).

(e) Dans le JSX de rendu, passer `showCamps` à `QuickActions` :
```tsx
        {canSubmit && <QuickActions showCamps={isChef} />}
```
Mettre à jour le subtitle du `PageHeader` pour le rendre didactique :
```tsx
      <PageHeader
        title={hello}
        subtitle="Voici ce que tu peux faire dans Baloo, et où aller pour chaque chose."
      />
```

- [ ] **Step 2 : `QuickActions` accepte `showCamps` et ajoute la carte Camps**

Remplacer la signature et le tableau d'actions de `QuickActions` :
```tsx
function QuickActions({ showCamps }: { showCamps: boolean }) {
  const actions: { href: string; label: string; description: string; icon: LucideIcon }[] = [
    {
      href: '/depot',
      label: 'Déposer un justif',
      description: "Une photo, un PDF — le trésorier rapproche après.",
      icon: Paperclip,
    },
    {
      href: '/remboursements/nouveau',
      label: 'Demander un remboursement',
      description: "Tu as avancé des frais ? Saisis ta demande et joins le justif.",
      icon: HandCoins,
    },
    {
      href: '/abandons/nouveau',
      label: 'Faire un don au groupe',
      description: 'Renoncer au remboursement → reçu fiscal CERFA pour défiscaliser.',
      icon: Gift,
    },
    ...(showCamps
      ? [
          {
            href: '/camps',
            label: 'Mes camps',
            description: "Suivi du budget et des dépenses du camp de ton unité.",
            icon: Tent,
          },
        ]
      : []),
  ];

  return (
    <div>
      <SectionHeader title="Que veux-tu faire ?" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {actions.map((a) => (
          <ActionCard key={a.href} {...a} />
        ))}
      </div>
      <Link
        href="/aide#rembs-vs-abandon"
        className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-brand hover:underline underline-offset-2 transition-colors"
      >
        <CircleHelp size={13} strokeWidth={1.75} />
        Hésite entre remboursement et abandon ? Voir la comparaison.
      </Link>
    </div>
  );
}
```

- [ ] **Step 3 : Vérifier qu'aucune branche `parent` ne subsiste dans la home**

Run: `cd web && grep -n "parent" "src/app/(app)/page.tsx"`
Expected: la seule occurrence possible est dans le tableau `SUBMIT_ROLES` (alias legacy). Aucune branche logique `=== 'parent'`. `WelcomeBanner` reçoit toujours `canSubmit` (désormais toujours `true` dans le rendu) — laisser tel quel, c'est inoffensif.

- [ ] **Step 4 : Compilation + lint + tests**

Run: `cd web && npx tsc --noEmit && npx eslint "src/app/(app)/page.tsx" && npx vitest run`
Expected: tout passe.

- [ ] **Step 5 : Commit**

```bash
git add "web/src/app/(app)/page.tsx"
git commit -m "feat(roles): home didactique par rôle (cartes process + camps pour chef)"
```

---

## Task 7 : Vérification end-to-end

**Files:** aucun (vérification).

- [ ] **Step 1 : Suite de tests complète**

Run: `cd web && npx vitest run`
Expected: PASS (tous fichiers).

- [ ] **Step 2 : Build de production**

Run: `cd web && npx next build`
Expected: build réussi, route table affichée. Les pages `/camps`, `/ecritures`, `/`, `/remboursements`, `/abandons` sont listées (dynamiques `ƒ`).

- [ ] **Step 3 : Vérif manuelle (dev) — à faire par l'utilisateur**

`cd web && pnpm dev`. Se connecter en trésorier (lien magic en console). Puis vérifier (idéalement avec un compte `membre` et un compte `chef` de test) :
- `membre` : la home `/` montre 3 cartes (Déposer, Remboursement, Don), pas de Camps ; `/camps` en URL directe → redirigé `/` ; `/ecritures` → redirigé `/` ; peut déposer/rembourser/abandonner.
- `chef` : home avec 4 cartes (dont Mes camps) ; `/camps` ne montre QUE les camps de son unité ; `/camps/<id>` d'une autre unité → `notFound`/redirect.
- admin : `/` redirige vers `/ecritures` ; voit tout.

- [ ] **Step 4 : Commit éventuel des correctifs**

Si la vérif a nécessité des ajustements, commit ciblé. Sinon rien.

---

## Notes pour l'implémenteur

- **Ordre important** : Task 1 supprime `requireNotParent` mais Task 3 met à jour ses appelants — entre les deux la compilation est cassée (attendu). Exécuter Task 1 → 2 → 3 dans l'ordre. À partir de la fin de Task 3, `npx tsc --noEmit` doit repasser au vert.
- **Aucun DELETE** sur `users` : la migration est un `UPDATE` (cf. règle projet).
- **Filtrage scope unité** (chef → sa seule unité) : déjà en place dans `camps.ts`/`ecritures.ts`/`remboursements.ts`, ne pas y toucher.
- **Périmètre chef** : inchangé hors camps. Ne pas retirer/ajouter d'accès au chef au-delà de ce qui est décrit.
