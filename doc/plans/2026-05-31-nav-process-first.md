# Refonte navigation v2 — façade process + administration repliée — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructurer la navigation autour de la façade « process » (déposer / remboursements / abandons) avec la gestion courante repliée dans un bloc « Administration », supprimer accueil-dashboard / inbox-de-la-nav / synthèse, et rediriger `/` selon le rôle.

**Architecture:** Refonte purement front + routes. Source de vérité unique `nav-config.ts` (deux groupes `process` / `administration`, items *role-switched* via `resolveNavItem`). Sidebar desktop rend le bloc Administration repliable. Bottom-nav mobile inchangée dans sa mécanique, seuls les onglets changent. `/` devient une redirection serveur par rôle. Aucune migration BDD.

**Tech Stack:** Next.js 16 (App Router, Server Components, `redirect` de `next/navigation`), React client components, Vitest + React Testing Library, Tailwind.

**Hors scope (suivis séparés) :** intégration fonctionnelle inbox→écritures (la page `/inbox` reste joignable par URL, juste retirée de la nav) ; espace parent dédié (le parent garde `/` comme « Mes reçus »).

**Référence spec :** [`doc/specs/2026-05-31-nav-process-first-design.md`](../specs/2026-05-31-nav-process-first-design.md).

---

## Décisions de cadrage (verrouillées en brainstorming)

- **Accueil `/`** : redirection par rôle — `tresorier`/`RG` → `/ecritures` ; `chef`/`equipier` → `/depot` ; `parent` → reste sur `/` (rendu « Mes reçus » existant).
- **Inbox** : retirée de la nav uniquement. Page `/inbox` conservée (joignable par URL). Intégration dans `/ecritures` = suivi séparé.
- **Synthèse** : `/synthese` ET `/synthese/unite/[id]` supprimées pour de bon, + composants `src/components/synthese/*`.
- **Budget** : `/budgets` conservée hors nav, lien depuis le header de `/ecritures`.
- **`/import`** : ré-exposée dans Administration sous « Configs Comptaweb » (page inchangée).
- **Parent** : ne va jamais sur `/remboursements` (reste fermé via `requireNotParent`). Ses entrées de nav pointent vers `/`.

## Boucles de redirection — invariants à préserver

`requireRole` renvoie vers `/`. La home `/` redirige par rôle. Vérifier qu'aucune cible ne renvoie vers `/` pour le même rôle :
- `tresorier`/`RG` → `/ecritures` (`requireNotParent` OK) ✅
- `chef` → `/depot` (`requireCanSubmit` autorise chef) ✅
- `equipier` → `/depot` (`requireCanSubmit` autorise equipier) ✅
- `parent` → reste sur `/` (pas de redirection) ✅

## File Structure

| Fichier | Responsabilité | Action |
|---|---|---|
| `web/src/components/layout/nav-config.ts` | Modèle de nav (groupes, items role-switched, helpers) | Réécrit |
| `web/src/components/layout/nav-config.test.ts` | Tests du modèle | Réécrit |
| `web/src/components/layout/sidebar.tsx` | Rendu sidebar desktop, bloc repliable | Modifié |
| `web/src/components/layout/sidebar.test.tsx` | Test du repli Administration | Créé |
| `web/src/components/layout/bottom-nav.test.tsx` | Tests onglets mobile | Modifié |
| `web/src/app/(app)/layout.tsx` | Layout auth, plumbing sidebar | Modifié (drop inbox count) |
| `web/src/app/(app)/page.tsx` | Home → redirection par rôle (parent gardé) | Modifié |
| `web/src/lib/actions/remboursements/create.ts` | Cible redirection succès/erreur | Modifié |
| `web/src/lib/actions/abandons.ts` | Cible redirection succès/erreur | Modifié |
| `web/src/app/(app)/remboursements/page.tsx` | Bandeaux succès/erreur relocalisés | Modifié |
| `web/src/app/(app)/abandons/page.tsx` | Bandeaux succès/erreur relocalisés | Modifié |
| `web/src/app/(app)/synthese/**` | Pages synthèse | Supprimé |
| `web/src/components/synthese/**` | Composants synthèse | Supprimé |
| `web/src/app/(app)/budgets/page.tsx` | Redirection chef (cible `/synthese` morte) | Modifié |
| `web/src/lib/actions/comptaweb-import.ts` | `revalidatePath('/synthese')` morts | Modifié |
| `web/src/lib/actions/repartitions.ts` | `revalidatePath('/synthese')` morts | Modifié |
| `web/src/app/(app)/ecritures/page.tsx` | Lien Budget dans le header | Modifié |

---

## Task 1 : Réécrire `nav-config.ts` (modèle process / administration)

**Files:**
- Modify: `web/src/components/layout/nav-config.ts`
- Test: `web/src/components/layout/nav-config.test.ts`

- [ ] **Step 1 : Réécrire le test** (`nav-config.test.ts`, remplacer tout le fichier)

```ts
import { describe, it, expect } from 'vitest';
import {
  DESKTOP_GROUPS,
  MOBILE_TABS,
  resolveNavItem,
  visibleItemsForRole,
  visibleTabsForRole,
  type NavGroup,
} from './nav-config';

function group(key: 'process' | 'administration'): NavGroup {
  const g = DESKTOP_GROUPS.find((x) => x.key === key);
  if (!g) throw new Error(`groupe ${key} absent`);
  return g;
}

describe('nav-config — structure des groupes', () => {
  it('expose exactement deux groupes : process puis administration', () => {
    expect(DESKTOP_GROUPS.map((g) => g.key)).toEqual(['process', 'administration']);
  });

  it('le bloc administration est repliable et replié par défaut', () => {
    const admin = group('administration');
    expect(admin.collapsible).toBe(true);
    expect(admin.defaultCollapsed).toBe(true);
  });
});

describe('nav-config — desktop, filtrage par rôle', () => {
  it('le trésorier voit les 3 process + tout le bloc administration', () => {
    const process = visibleItemsForRole(group('process').items, 'tresorier').map((i) => i.href);
    expect(process).toEqual(['/depot', '/remboursements', '/abandons']);
    const admin = visibleItemsForRole(group('administration').items, 'tresorier').map((i) => i.href);
    expect(admin).toContain('/ecritures');
    expect(admin).toContain('/caisse');
    expect(admin).toContain('/import');
  });

  it('le chef ne voit aucun item du bloc administration', () => {
    expect(visibleItemsForRole(group('administration').items, 'chef')).toHaveLength(0);
  });

  it('le parent ne voit que Remboursements dans process', () => {
    const process = visibleItemsForRole(group('process').items, 'parent').map((i) => i.href);
    expect(process).toEqual(['/remboursements']);
    expect(visibleItemsForRole(group('administration').items, 'parent')).toHaveLength(0);
  });
});

describe('nav-config — resolveNavItem (role-switch)', () => {
  const depot = group('process').items.find((i) => i.href === '/depot')!;
  const rembs = group('process').items.find((i) => i.href === '/remboursements')!;

  it('Déposer pointe vers /depots avec le libellé "Dépôts" pour un admin', () => {
    expect(resolveNavItem(depot, 'tresorier')).toMatchObject({ href: '/depots', label: 'Dépôts' });
  });

  it('Déposer pointe vers /depot avec le libellé "Déposer" pour un equipier', () => {
    expect(resolveNavItem(depot, 'equipier')).toMatchObject({ href: '/depot', label: 'Déposer' });
  });

  it('Remboursements : "Remboursements" pour admin, "Mes demandes" pour equipier, "Mes reçus"→/ pour parent', () => {
    expect(resolveNavItem(rembs, 'RG').label).toBe('Remboursements');
    expect(resolveNavItem(rembs, 'equipier').label).toBe('Mes demandes');
    expect(resolveNavItem(rembs, 'parent')).toMatchObject({ href: '/', label: 'Mes reçus' });
  });
});

describe('nav-config — mobile', () => {
  it('le trésorier voit Déposer / Demandes / Abandons / Plus', () => {
    expect(visibleTabsForRole('tresorier').map((t) => t.key)).toEqual([
      'depot', 'demandes', 'abandons', 'plus',
    ]);
  });

  it("l'equipier voit Déposer / Demandes / Abandons, sans Plus", () => {
    expect(visibleTabsForRole('equipier').map((t) => t.key)).toEqual(['depot', 'demandes', 'abandons']);
  });

  it('le parent voit seulement "Mes reçus" pointant vers /', () => {
    const tabs = visibleTabsForRole('parent');
    expect(tabs.map((t) => t.key)).toEqual(['recus']);
    expect(tabs[0].href).toBe('/');
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd web && pnpm vitest run src/components/layout/nav-config.test.ts`
Expected: FAIL (l'ancien modèle `Intent`/`badgeKey` ne fournit pas `resolveNavItem`, `key`, etc.)

- [ ] **Step 3 : Réécrire `nav-config.ts`** (remplacer tout le fichier)

```ts
import {
  BookOpen, Bot, Coins, Ellipsis, FileText, Gift, HandCoins, Link2, Mail,
  Paperclip, ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

export type Role = 'tresorier' | 'RG' | 'chef' | 'equipier' | 'parent';
export type GroupKey = 'process' | 'administration';

const ADMIN: Role[] = ['tresorier', 'RG'];
const SUBMITTERS: Role[] = ['tresorier', 'RG', 'chef', 'equipier'];

export function isAdminRole(role: string): boolean {
  return role === 'tresorier' || role === 'RG';
}

export interface NavItem {
  /** href par défaut (membre non-admin, non-parent). */
  href: string;
  /** href admin (ex. Déposer → liste /depots). */
  adminHref?: string;
  /** href parent (ex. Mes reçus → /). */
  parentHref?: string;
  /** libellé par défaut. */
  label: string;
  /** libellé admin. */
  adminLabel?: string;
  /** libellé parent. */
  parentLabel?: string;
  icon: LucideIcon;
  /** Rôles autorisés. Absent = tous les rôles authentifiés. */
  roles?: Role[];
}

export interface NavGroup {
  key: GroupKey;
  title: string;
  /** Bloc repliable (Administration). */
  collapsible?: boolean;
  /** Replié par défaut. */
  defaultCollapsed?: boolean;
  items: NavItem[];
}

export interface ResolvedNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Desktop : façade « process » (filtrée par rôle, items role-switched) + bloc
// « Administration » repliable réservé aux admins. /cloture et /inbox restent
// hors nav (accès par lien direct). Suite ADR-033 / spec 2026-05-31.
export const DESKTOP_GROUPS: NavGroup[] = [
  {
    key: 'process',
    title: 'Process',
    items: [
      { href: '/depot', adminHref: '/depots', label: 'Déposer', adminLabel: 'Dépôts', icon: Paperclip, roles: SUBMITTERS },
      { href: '/remboursements', parentHref: '/', label: 'Mes demandes', adminLabel: 'Remboursements', parentLabel: 'Mes reçus', icon: HandCoins },
      { href: '/abandons', label: 'Abandons', icon: Gift, roles: SUBMITTERS },
    ],
  },
  {
    key: 'administration',
    title: 'Administration',
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { href: '/ecritures', label: 'Écritures', icon: BookOpen, roles: ADMIN },
      { href: '/caisse', label: 'Caisse', icon: Coins, roles: ADMIN },
      { href: '/import', label: 'Configs Comptaweb', icon: Link2, roles: ADMIN },
      { href: '/moi/connexions', label: 'Connexion Claude', icon: Bot, roles: ADMIN },
      { href: '/admin/invitations', label: 'Membres', icon: Mail, roles: ADMIN },
      { href: '/admin/errors', label: "Journal d'erreurs", icon: ShieldAlert, roles: ADMIN },
    ],
  },
];

/** Résout href + label d'un item selon le rôle (admin / parent / défaut). */
export function resolveNavItem(item: NavItem, role: string): ResolvedNavItem {
  const admin = isAdminRole(role);
  let href = item.href;
  if (role === 'parent' && item.parentHref) href = item.parentHref;
  else if (admin && item.adminHref) href = item.adminHref;

  let label = item.label;
  if (role === 'parent' && item.parentLabel) label = item.parentLabel;
  else if (admin && item.adminLabel) label = item.adminLabel;

  return { href, label, icon: item.icon };
}

export interface MobileTab {
  key: 'depot' | 'recus' | 'demandes' | 'abandons' | 'plus';
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
}

// Mobile : process en bas + tiroir « Plus » (admins). L'ordre du tableau =
// ordre d'affichage. 'recus' (parent, → /) placé avant 'demandes' pour que le
// parent ait bien son onglet unique.
export const MOBILE_TABS: MobileTab[] = [
  { key: 'depot', href: '/depot', label: 'Déposer', icon: Paperclip, roles: SUBMITTERS },
  { key: 'recus', href: '/', label: 'Mes reçus', icon: FileText, roles: ['parent'] },
  { key: 'demandes', href: '/remboursements', label: 'Demandes', icon: HandCoins, roles: SUBMITTERS },
  { key: 'abandons', href: '/abandons', label: 'Abandons', icon: Gift, roles: SUBMITTERS },
  { key: 'plus', href: '#plus', label: 'Plus', icon: Ellipsis, roles: ADMIN },
];

function roleAllowed(roles: Role[] | undefined, role: string): boolean {
  return !roles || roles.includes(role as Role);
}

export function visibleItemsForRole(items: NavItem[], role: string): NavItem[] {
  return items.filter((i) => roleAllowed(i.roles, role));
}

export function visibleTabsForRole(role: string): MobileTab[] {
  return MOBILE_TABS.filter((t) => roleAllowed(t.roles, role));
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd web && pnpm vitest run src/components/layout/nav-config.test.ts`
Expected: PASS (tous les `it`)

- [ ] **Step 5 : Commit**

```bash
git add web/src/components/layout/nav-config.ts web/src/components/layout/nav-config.test.ts
git commit -m "feat(nav): modèle process/administration + resolveNavItem role-switch"
```

---

## Task 2 : Sidebar desktop — bloc Administration repliable

**Files:**
- Modify: `web/src/components/layout/sidebar.tsx`
- Test: `web/src/components/layout/sidebar.test.tsx` (créé)

**Contexte :** la sidebar est un client component persistant dans le layout (non remonté entre navigations App Router), donc un `useState` de repli survit à la navigation intra-app. On rend `process` à plat et `administration` derrière un bouton repliable (replié par défaut via `group.defaultCollapsed`). On retire tout le plumbing `inboxCount`/badge (plus d'item Inbox).

- [ ] **Step 1 : Écrire le test** (`sidebar.test.tsx`, nouveau fichier)

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './sidebar';

vi.mock('next/navigation', () => ({ usePathname: () => '/depot' }));

describe('<Sidebar> — bloc Administration repliable', () => {
  it('un admin voit le bouton Administration, items masqués par défaut', () => {
    render(<Sidebar role="tresorier" />);
    expect(screen.getByRole('button', { name: /administration/i })).toBeTruthy();
    // Replié par défaut : l'item Écritures n'est pas rendu.
    expect(screen.queryByText('Écritures')).toBeNull();
  });

  it('cliquer sur Administration déplie les items', () => {
    render(<Sidebar role="tresorier" />);
    fireEvent.click(screen.getByRole('button', { name: /administration/i }));
    expect(screen.getByText('Écritures')).toBeTruthy();
    expect(screen.getByText('Configs Comptaweb')).toBeTruthy();
  });

  it("un chef ne voit pas le bloc Administration", () => {
    render(<Sidebar role="chef" />);
    expect(screen.queryByRole('button', { name: /administration/i })).toBeNull();
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd web && pnpm vitest run src/components/layout/sidebar.test.tsx`
Expected: FAIL (Sidebar attend encore `inboxCount`, pas de bouton Administration)

- [ ] **Step 3 : Réécrire `sidebar.tsx`** (remplacer tout le fichier)

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, CircleHelp, type LucideIcon } from 'lucide-react';
import { InstallButton } from '@/components/pwa/install-button';
import { SyncStatusButton } from '@/components/sync/sync-status-button';
import { cn } from '@/lib/utils';
import {
  DESKTOP_GROUPS,
  resolveNavItem,
  visibleItemsForRole,
  type NavGroup,
} from './nav-config';

interface SidebarProps {
  role: string;
  groupName?: string | null;
}

export function Sidebar({ role, groupName }: SidebarProps) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="w-[260px] shrink-0 flex flex-col h-full">
      {/* Wordmark */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'relative h-9 w-9 shrink-0 rounded-xl flex items-center justify-center',
              'bg-gradient-to-br from-brand to-[oklch(0.22_0.08_252)]',
              'shadow-sm shadow-brand/20 ring-1 ring-inset ring-white/10',
            )}
            aria-hidden
          >
            <span className="text-[15px] leading-none">🐻</span>
            <span className="absolute inset-0 rounded-xl bg-gradient-to-tr from-transparent to-white/15 pointer-events-none" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="font-display text-[15px] font-medium tracking-tight text-fg truncate">
              Baloo
            </div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-fg-muted truncate">
              {groupName ? `Compta · ${groupName}` : 'Compta SGDF'}
            </div>
          </div>
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4 [scrollbar-gutter:stable]">
        {DESKTOP_GROUPS.map((g) => (
          <NavSection key={g.key} group={g} role={role} isActive={isActive} />
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border-soft p-2 space-y-2">
        <div className="px-1">
          <InstallButton />
        </div>
        {(role === 'tresorier' || role === 'RG') && (
          <div className="px-1">
            <SyncStatusButton />
          </div>
        )}
        <NavLink href="/aide" icon={CircleHelp} active={pathname === '/aide'} variant="subtle">
          Aide & guide
        </NavLink>
      </div>
    </div>
  );
}

function NavSection({
  group,
  role,
  isActive,
}: {
  group: NavGroup;
  role: string;
  isActive: (href: string) => boolean;
}) {
  const items = visibleItemsForRole(group.items, role);
  const [open, setOpen] = useState(!group.defaultCollapsed);
  if (items.length === 0) return null;

  const list = (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const resolved = resolveNavItem(item, role);
        return (
          <li key={resolved.href}>
            <NavLink href={resolved.href} icon={resolved.icon} active={isActive(resolved.href)}>
              {resolved.label}
            </NavLink>
          </li>
        );
      })}
    </ul>
  );

  if (!group.collapsible) {
    return (
      <div className="mt-5 first:mt-1">
        <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
          {group.title}
        </div>
        {list}
      </div>
    );
  }

  return (
    <div className="mt-5 first:mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-3 mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle hover:text-fg-muted transition-colors"
      >
        <ChevronDown
          size={11}
          strokeWidth={2.5}
          className={cn('transition-transform', open ? '' : '-rotate-90')}
        />
        {group.title}
      </button>
      {open && list}
    </div>
  );
}

interface NavLinkProps {
  href: string;
  icon: LucideIcon;
  active: boolean;
  children: React.ReactNode;
  variant?: 'default' | 'subtle';
}

function NavLink({ href, icon: Icon, active, children, variant = 'default' }: NavLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-all duration-100',
        active
          ? variant === 'default'
            ? 'bg-brand-50 text-brand shadow-[inset_2px_0_0_var(--brand)]'
            : 'bg-fg/[0.06] text-fg'
          : 'text-fg-muted hover:text-fg hover:bg-fg/[0.035]',
      )}
    >
      <Icon
        size={15}
        strokeWidth={active ? 2.25 : 1.75}
        className={cn(
          'shrink-0',
          active
            ? variant === 'default'
              ? 'text-brand'
              : 'text-fg'
            : 'text-fg-subtle group-hover:text-fg-muted',
        )}
      />
      <span className="truncate flex-1">{children}</span>
    </Link>
  );
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd web && pnpm vitest run src/components/layout/sidebar.test.tsx`
Expected: PASS

- [ ] **Step 5 : Commit**

```bash
git add web/src/components/layout/sidebar.tsx web/src/components/layout/sidebar.test.tsx
git commit -m "feat(nav): sidebar à deux étages, bloc Administration repliable"
```

---

## Task 3 : Mettre à jour les tests du bottom-nav

**Files:**
- Test: `web/src/components/layout/bottom-nav.test.tsx`

**Note :** `bottom-nav.tsx` n'a PAS besoin de changer — il consomme `visibleTabsForRole` et gère déjà `tab.key === 'plus'`. Seules les attentes du test changent (onglets nouveaux).

- [ ] **Step 1 : Réécrire le test** (remplacer tout le fichier)

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomNav } from './bottom-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

describe('<BottomNav>', () => {
  it("l'equipier voit Déposer / Demandes / Abandons, sans Plus", () => {
    render(<BottomNav role="equipier" />);
    expect(screen.getByText('Déposer')).toBeTruthy();
    expect(screen.getByText('Demandes')).toBeTruthy();
    expect(screen.getByText('Abandons')).toBeTruthy();
    expect(screen.queryByText('Plus')).toBeNull();
  });

  it('le parent voit seulement Mes reçus', () => {
    render(<BottomNav role="parent" />);
    expect(screen.getByText('Mes reçus')).toBeTruthy();
    expect(screen.queryByText('Déposer')).toBeNull();
    expect(screen.queryByText('Abandons')).toBeNull();
  });

  it("le trésorier voit l'onglet Plus et le clic déclenche onOpenMore", () => {
    const onOpenMore = vi.fn();
    render(<BottomNav role="tresorier" onOpenMore={onOpenMore} />);
    const plus = screen.getByText('Plus');
    expect(plus).toBeTruthy();
    fireEvent.click(plus);
    expect(onOpenMore).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2 : Lancer le test**

Run: `cd web && pnpm vitest run src/components/layout/bottom-nav.test.tsx`
Expected: PASS (le composant gère déjà ces tabs via le nouveau `MOBILE_TABS`)

- [ ] **Step 3 : Commit**

```bash
git add web/src/components/layout/bottom-nav.test.tsx
git commit -m "test(nav): onglets bottom-nav (déposer/demandes/abandons/plus)"
```

---

## Task 4 : Nettoyer le plumbing inbox du layout

**Files:**
- Modify: `web/src/app/(app)/layout.tsx`

- [ ] **Step 1 : Modifier `layout.tsx`** — retirer l'import `countInboxItems`, le calcul `isAdmin`/`inboxCount`, et ne plus passer `inboxCount` à `Sidebar`.

Remplacer l'en-tête d'imports et le corps. Supprimer la ligne :
```ts
import { countInboxItems } from '@/lib/queries/inbox';
```
Supprimer le bloc :
```ts
  const isAdmin = ctx.role === 'tresorier' || ctx.role === 'RG';
  const inboxCount = isAdmin ? await countInboxItems(ctx.groupId) : 0;
```
Et remplacer les deux `<Sidebar role={ctx.role} inboxCount={inboxCount} />` par :
```tsx
<Sidebar role={ctx.role} />
```

- [ ] **Step 2 : Vérifier le typecheck**

Run: `cd web && pnpm tsc --noEmit`
Expected: aucune erreur liée à `layout.tsx` ni `Sidebar` (la prop `inboxCount` n'existe plus).

- [ ] **Step 3 : Commit**

```bash
git add web/src/app/\(app\)/layout.tsx
git commit -m "refactor(nav): retire le compteur inbox du layout (item Inbox sorti de la nav)"
```

---

## Task 5 : Home `/` → redirection par rôle (parent conservé)

**Files:**
- Modify: `web/src/app/(app)/page.tsx`

**Contexte :** la home cesse d'être un dashboard pour les non-parents (redirection immédiate). Le `parent` garde le rendu existant (« Mes reçus »). Cette task ajoute UNIQUEMENT la redirection en tête ; la suppression de la branche admin morte (qui référence `/synthese` et `/inbox`) est faite en Task 7 avec la suppression de la synthèse.

- [ ] **Step 1 : Ajouter la redirection en tête du composant `page.tsx`**

Après la résolution du contexte (`const ctx = await getCurrentContext();`, en début de `HomePage`), insérer immédiatement :
```ts
  // La home n'est plus un dashboard : redirection par rôle (spec 2026-05-31).
  // Le parent garde cette page comme « Mes reçus » (rendu plus bas).
  if (ctx.role === 'tresorier' || ctx.role === 'RG') redirect('/ecritures');
  if (ctx.role !== 'parent') redirect('/depot');
```

S'assurer que l'import est présent en haut du fichier :
```ts
import { redirect } from 'next/navigation';
```

Et que la page reste dynamique (auth/cookies — piège Next 16, cf. `web/AGENTS.md`). Ajouter si absent, sous les imports :
```ts
export const dynamic = 'force-dynamic';
```

- [ ] **Step 2 : Vérifier le typecheck + absence de boucle (lecture)**

Run: `cd web && pnpm tsc --noEmit`
Expected: pas d'erreur. Relire les invariants de la section « Boucles de redirection » : `/ecritures` (admin), `/depot` (chef/equipier) n'effectuent jamais `redirect('/')` pour ces rôles.

- [ ] **Step 3 : Commit**

```bash
git add web/src/app/\(app\)/page.tsx
git commit -m "feat(nav): home redirige par rôle (admin→écritures, membre→dépôt), parent gardé"
```

---

## Task 6 : Relocaliser le feedback de création de demande hors de la home

**Files:**
- Modify: `web/src/lib/actions/remboursements/create.ts`
- Modify: `web/src/lib/actions/abandons.ts`
- Modify: `web/src/app/(app)/remboursements/page.tsx`
- Modify: `web/src/app/(app)/abandons/page.tsx`

**Contexte :** les créations redirigeaient vers `/?rbt_created=` / `/?abandon_created=` pour afficher un bandeau sur la home. La home redirigeant désormais les créateurs (chef/equipier/admin) ailleurs, ce bandeau ne s'afficherait jamais. On relocalise le succès/erreur sur la page liste correspondante.

- [ ] **Step 1 : Modifier les redirections dans `create.ts`**

Dans `web/src/lib/actions/remboursements/create.ts` :
- Remplacer `redirect('/?rbt_created=' + encodeURIComponent(result.rbtId));` par
  `redirect('/remboursements?rbt_created=' + encodeURIComponent(result.rbtId));`
- Remplacer `redirect('/?error=' + encodeURIComponent('Action non autorisée pour ton rôle.'));` par
  `redirect('/remboursements/nouveau?error=' + encodeURIComponent('Action non autorisée pour ton rôle.'));`

(Grep de contrôle si les numéros de ligne ont bougé : `grep -n "redirect('/?" web/src/lib/actions/remboursements/create.ts` ne doit plus rien renvoyer après coup.)

- [ ] **Step 2 : Modifier les redirections dans `abandons.ts`**

Dans `web/src/lib/actions/abandons.ts` :
- Remplacer `redirect('/?abandon_created=' + encodeURIComponent(created.id));` par
  `redirect('/abandons?abandon_created=' + encodeURIComponent(created.id));`
- S'il existe une redirection d'erreur `redirect('/?error=' + ...)` dans ce fichier, la repointer vers `/abandons/nouveau?error=` (grep : `grep -n "redirect('/?" web/src/lib/actions/abandons.ts`).

- [ ] **Step 3 : Afficher le bandeau succès/erreur sur `/remboursements`**

Dans `web/src/app/(app)/remboursements/page.tsx` :
- Ajouter l'import s'il manque : `import { Alert } from '@/components/ui/alert';`
- Récupérer les params (déjà disponibles via `params`). Juste après l'ouverture du `<div>` de retour (avant `<PageHeader>`), insérer :
```tsx
      {params.rbt_created && (
        <Alert variant="success" className="mb-6">
          Demande <code className="font-mono text-[12.5px] font-medium">{params.rbt_created}</code> enregistrée. Tu recevras un mail à chaque étape.
        </Alert>
      )}
      {params.error && (
        <Alert variant="error" className="mb-6">{params.error}</Alert>
      )}
```

- [ ] **Step 4 : Afficher le bandeau succès/erreur sur `/abandons`**

Dans `web/src/app/(app)/abandons/page.tsx` :
- Ajouter l'import `Alert` s'il manque.
- S'assurer que les `searchParams` sont lus (suivre le pattern existant de la page ; si la page ne lit pas encore `searchParams`, ajouter le param `searchParams: Promise<Record<string,string|undefined>>` et `const params = await searchParams;`).
- Juste après l'ouverture du `<div>` de retour, insérer :
```tsx
      {params.abandon_created && (
        <Alert variant="success" className="mb-6">
          Don <code className="font-mono text-[12.5px] font-medium">{params.abandon_created}</code> enregistré. Le CERFA arrivera par mail après validation.
        </Alert>
      )}
      {params.error && (
        <Alert variant="error" className="mb-6">{params.error}</Alert>
      )}
```

- [ ] **Step 5 : Vérifier typecheck + build ciblé**

Run: `cd web && pnpm tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 6 : Commit**

```bash
git add web/src/lib/actions/remboursements/create.ts web/src/lib/actions/abandons.ts web/src/app/\(app\)/remboursements/page.tsx web/src/app/\(app\)/abandons/page.tsx
git commit -m "feat(nav): bandeaux succès/erreur de création relocalisés sur /remboursements et /abandons"
```

---

## Task 7 : Supprimer la synthèse + nettoyer ses dépendances

**Files:**
- Delete: `web/src/app/(app)/synthese/page.tsx`
- Delete: `web/src/app/(app)/synthese/unite/[id]/page.tsx` (et le dossier `synthese/`)
- Delete: `web/src/components/synthese/*`
- Modify: `web/src/app/(app)/budgets/page.tsx` (cible de redirection morte)
- Modify: `web/src/lib/actions/comptaweb-import.ts` (`revalidatePath('/synthese')`)
- Modify: `web/src/lib/actions/repartitions.ts` (`revalidatePath('/synthese')`)
- Modify: `web/src/app/(app)/page.tsx` (retirer la branche admin morte référençant `/synthese` et `/inbox`)

- [ ] **Step 1 : Vérifier les importateurs des composants synthèse**

Run: `cd web && grep -rn "components/synthese" src`
Expected: les seuls importateurs sont `synthese/page.tsx` et `synthese/unite/[id]/page.tsx` (qui vont être supprimés). Si un autre fichier importe `components/synthese/*`, S'ARRÊTER et le signaler (dépendance inattendue à traiter avant suppression).

- [ ] **Step 2 : Supprimer les pages et composants synthèse**

```bash
git rm -r web/src/app/\(app\)/synthese
git rm -r web/src/components/synthese
```

- [ ] **Step 3 : Réparer la redirection chef dans `budgets/page.tsx`**

Remplacer `redirect('/synthese');` (dans le garde `if (!ADMIN_ROLES.includes(ctx.role))`) par `redirect('/');` (la home re-route alors le rôle correctement : un chef atterrit sur `/depot`).

- [ ] **Step 4 : Nettoyer les `revalidatePath('/synthese')`**

Dans `web/src/lib/actions/comptaweb-import.ts` : supprimer chaque ligne `revalidatePath('/synthese');` (conserver les `revalidatePath('/import')` et `revalidatePath('/ecritures')`).
Dans `web/src/lib/actions/repartitions.ts` : remplacer chaque `revalidatePath('/synthese');` par `revalidatePath('/budgets');` (les répartitions par unité alimentent désormais le budget, plus la synthèse).

Contrôle : `grep -rn "revalidatePath('/synthese')\|href=\"/synthese\"\|'/synthese'" web/src` ne doit plus renvoyer que d'éventuelles occurrences dans `page.tsx` (traitées au step suivant).

- [ ] **Step 5 : Retirer la branche admin morte de la home**

Dans `web/src/app/(app)/page.tsx`, les admins sont redirigés en tête (Task 5) : tout le rendu réservé aux admins (cartes dashboard, CTA vers `/inbox` et `/synthese`, sous-composant `AdminHome` le cas échéant) est désormais du code mort. Le supprimer ainsi que les imports devenus inutilisés (`Inbox`, `TrendingUp`, `Unlink`, et tout helper exclusivement admin). Conserver intégralement la branche `parent` (« Mes reçus ») et ses imports.

Contrôle final : `grep -rn "/synthese\|href=\"/inbox\"" web/src/app/\(app\)/page.tsx`
Expected: aucune occurrence.

- [ ] **Step 6 : Typecheck + suite de tests + grep global**

Run: `cd web && pnpm tsc --noEmit && pnpm vitest run`
Expected: pas d'erreur de type (aucune référence morte à synthèse/ses composants), tests verts.
Run: `cd web && grep -rn "'/synthese'\|\"/synthese\"\|components/synthese" src`
Expected: aucune occurrence.

- [ ] **Step 7 : Commit**

```bash
git add -A
git commit -m "feat(nav): supprime la synthèse (pages + composants) et nettoie ses références"
```

---

## Task 8 : Lien Budget dans le header de `/ecritures`

**Files:**
- Modify: `web/src/app/(app)/ecritures/page.tsx`

**Contexte :** `/budgets` sort de la nav ; on l'atteint via le header des écritures. `PageHeader` accepte `actions` (barre sous le titre) et `meta` (bloc à droite du titre). On ajoute un lien discret dans `meta`.

- [ ] **Step 1 : Ajouter le lien Budget au `PageHeader` des écritures**

Dans `web/src/app/(app)/ecritures/page.tsx`, sur le `<PageHeader title="Écritures">` existant, ajouter une prop `meta` :
```tsx
      <PageHeader
        title="Écritures"
        meta={
          <Link
            href="/budgets"
            className="text-[12.5px] font-medium text-fg-muted hover:text-brand transition-colors inline-flex items-center gap-1"
          >
            <Calculator size={13} strokeWidth={2} />
            Budget
          </Link>
        }
      >
        {/* boutons existants (ScanDraftsButton, Nouvelle écriture) inchangés */}
      </PageHeader>
```
Ajouter les imports manquants en haut du fichier : `Link` depuis `next/link` (probablement déjà importé) et `Calculator` depuis `lucide-react`.

- [ ] **Step 2 : Vérifier le typecheck**

Run: `cd web && pnpm tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 3 : Commit**

```bash
git add web/src/app/\(app\)/ecritures/page.tsx
git commit -m "feat(nav): lien Budget dans le header des écritures"
```

---

## Task 9 : Vérification finale

**Files:** aucun (vérification)

- [ ] **Step 1 : Suite de tests complète**

Run: `cd web && pnpm vitest run`
Expected: tous verts (notamment `nav-config`, `sidebar`, `bottom-nav`).

- [ ] **Step 2 : Typecheck + build**

Run: `cd web && pnpm tsc --noEmit && pnpm build`
Expected: build OK, aucune page ne casse au prérendu (attention `force-dynamic` sur `/`).

- [ ] **Step 3 : Grep anti-régression**

Run:
```bash
cd web && grep -rn "components/synthese\|'/synthese'\|inboxCount\|badgeKey" src
```
Expected: aucune occurrence (synthèse supprimée, plumbing inbox retiré).
Run: `cd web && grep -rn "redirect('/?rbt_created\|redirect('/?abandon_created" src`
Expected: aucune occurrence (feedback relocalisé).

- [ ] **Step 4 : Vérification manuelle (dev) des parcours par rôle**

Démarrer `pnpm dev` et vérifier (en basculant le rôle de l'utilisateur de test) :
- `tresorier` : `/` redirige vers `/ecritures` ; sidebar = Process (Dépôts/Remboursements/Abandons) + Administration repliée (déplier → Écritures, Caisse, Configs Comptaweb, Connexion Claude, Membres, Erreurs) ; header écritures a un lien Budget.
- `chef`/`equipier` : `/` redirige vers `/depot` ; sidebar = Process seulement, pas d'Administration.
- `parent` : `/` reste sur « Mes reçus » ; bottom-nav mobile = un seul onglet « Mes reçus » → `/`.
- Créer une demande de remboursement → atterrit sur `/remboursements` avec bandeau succès.
- `/import` accessible via « Configs Comptaweb » et le bouton de sync des référentiels y est présent.

- [ ] **Step 5 : Mettre à jour le journal des décisions (ADR-034)**

Ajouter une entrée `ADR-034` dans `doc/decisions.md` résumant cette refonte (façade process + Administration repliée, suppression synthèse, home par rôle, ré-expo Configs Comptaweb), avec liens vers cette spec et ce plan. Marquer l'ADR-033 comme partiellement révisé (le découpage par intention est remplacé). Commit :
```bash
git add doc/decisions.md
git commit -m "doc(adr): ADR-034 refonte nav v2 (façade process + administration)"
```

---

## Self-review (rempli par l'auteur du plan)

- **Couverture spec :** structure sidebar (T1/T2), mobile (T1/T3), redirection `/` par rôle (T5), suppression synthèse + sous-route (T7), inbox hors nav (T1 + plumbing T4 ; intégration = suivi séparé, annoncé), budget en header (T8), ré-expo `/import` (T1). ✅
- **Écart assumé vs spec :** la spec disait « parent → /remboursements » ; le plan route le parent vers `/` (sa page « Mes reçus » existante) pour éviter une boucle de redirection avec `requireNotParent` et une refonte de la vue parent hors scope. Même résultat utilisateur, moins de risque.
- **Placeholders :** aucun TODO/TBD ; les seuls renvois « suivre le pattern existant » concernent la lecture de `searchParams` sur `/abandons` (signature fournie).
- **Cohérence des types :** `resolveNavItem` / `NavGroup.key` / `MobileTab.key` cohérents entre T1, T2 (sidebar) et T3 (tests bottom-nav).
