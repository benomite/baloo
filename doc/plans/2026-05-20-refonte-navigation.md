# Refonte navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réorganiser la navigation en deux expériences (poste de pilotage trésorier sur desktop rangé par intention, app membre sur mobile en bottom-nav), ajouter une page guide d'installation du MCP, et unifier les formulaires de demande dupliqués.

**Architecture:** Une source de vérité unique de navigation (`nav-config.ts`) consommée par la sidebar desktop ET la bottom-nav mobile. Le viewport décide du composant rendu (breakpoint `lg`), le rôle filtre les items. Pas de duplication d'app. Les formulaires remboursement/abandon passent de deux variantes (trésorier / `/moi`) à un seul formulaire avec demandeur prérempli modifiable.

**Tech Stack:** Next.js 16 (App Router, Server + Client Components), React 19, Tailwind, Vitest + Testing Library (jsdom), libsql/Turso, Auth.js v5.

**Spec de référence :** [doc/specs/2026-05-20-refonte-navigation-design.md](../specs/2026-05-20-refonte-navigation-design.md)

---

## Structure de fichiers

```
web/src/components/layout/
  nav-config.ts          (NOUVEAU) source de vérité : groupes d'intention, items, rôles, icônes
  nav-config.test.ts     (NOUVEAU) tests du filtrage par rôle
  sidebar.tsx            (MODIF) desktop : consomme nav-config, 4 groupes d'intention
  bottom-nav.tsx         (NOUVEAU) mobile : bottom-nav membre + onglet "Plus" admin
  bottom-nav.test.tsx    (NOUVEAU) tests rendu par rôle
  mobile-nav.tsx         (MODIF) le drawer reste pour l'accès "Plus" trésorier sur mobile
web/src/app/(app)/
  layout.tsx             (MODIF) orchestre sidebar (lg+) vs bottom-nav (<lg)
  moi/connexions/page.tsx (MODIF) guide install MCP enrichi
  remboursements/nouveau/page.tsx (MODIF) formulaire unifié
  moi/remboursements/    (SUPPR)
  abandons/nouveau/page.tsx (MODIF) formulaire unifié
  moi/abandons/          (SUPPR)
web/src/components/rembs/
  remboursement-form.tsx (MODIF) un seul identityMode prérempli
web/src/components/abandons/
  abandon-form.tsx       (NOUVEAU) extrait des 2 formulaires inline dupliqués
web/src/lib/actions/
  remboursements/create.ts (MODIF) une action unifiée
  abandons.ts            (MODIF) une action unifiée
```

---

## PHASE A — Navigation

### Task 1 : `nav-config.ts` — source de vérité de la navigation

**Files:**
- Create: `web/src/components/layout/nav-config.ts`
- Create: `web/src/components/layout/nav-config.test.ts`
- Reference: `web/src/lib/auth/access.ts` (ADMIN_ROLES, COMPTA_ROLES, SUBMIT_ROLES)

- [ ] **Step 1: Écrire le test du filtrage par rôle**

```ts
// web/src/components/layout/nav-config.test.ts
import { describe, it, expect } from 'vitest';
import { DESKTOP_GROUPS, MOBILE_TABS, visibleItemsForRole, visibleTabsForRole } from './nav-config';

describe('nav-config — desktop', () => {
  it('le trésorier voit les 4 groupes d intention', () => {
    const groups = DESKTOP_GROUPS.filter((g) => visibleItemsForRole(g.items, 'tresorier').length > 0);
    expect(groups.map((g) => g.intent)).toEqual(['piloter', 'saisir', 'demandes', 'gerer']);
  });

  it('le chef ne voit que Synthèse et Budget (scopés) dans Piloter', () => {
    const piloter = DESKTOP_GROUPS.find((g) => g.intent === 'piloter')!;
    const items = visibleItemsForRole(piloter.items, 'chef').map((i) => i.href);
    expect(items).toEqual(['/synthese', '/budgets']);
  });

  it('aucun item compta ne fuit vers equipier sur desktop', () => {
    const all = DESKTOP_GROUPS.flatMap((g) => visibleItemsForRole(g.items, 'equipier'));
    expect(all.map((i) => i.href)).not.toContain('/ecritures');
    expect(all.map((i) => i.href)).not.toContain('/caisse');
  });

  it('Import et Clôture ne sont dans aucun groupe', () => {
    const hrefs = DESKTOP_GROUPS.flatMap((g) => g.items).map((i) => i.href);
    expect(hrefs).not.toContain('/import');
    expect(hrefs).not.toContain('/cloture');
  });
});

describe('nav-config — mobile', () => {
  it('equipier voit 3 onglets : accueil, depot, mes-demandes', () => {
    expect(visibleTabsForRole('equipier').map((t) => t.key)).toEqual(['accueil', 'depot', 'demandes']);
  });

  it('parent voit accueil + mes reçus (pas depot)', () => {
    const keys = visibleTabsForRole('parent').map((t) => t.key);
    expect(keys).toContain('recus');
    expect(keys).not.toContain('depot');
  });

  it('trésorier voit les 3 onglets membre + onglet plus', () => {
    expect(visibleTabsForRole('tresorier').map((t) => t.key)).toEqual(['accueil', 'depot', 'demandes', 'plus']);
  });
});
```

- [ ] **Step 2: Run le test, vérifier qu'il échoue**

Run: `pnpm vitest run nav-config`
Expected: FAIL — `nav-config` n'existe pas encore.

- [ ] **Step 3: Implémenter `nav-config.ts`**

```ts
// web/src/components/layout/nav-config.ts
import {
  BookOpen, Calculator, Coins, Gift, HandCoins, Home, Inbox, Mail,
  Package, Paperclip, ShieldAlert, TrendingUp, Link2, Bot, FileText,
  type LucideIcon,
} from 'lucide-react';

export type Role = 'tresorier' | 'RG' | 'chef' | 'equipier' | 'parent';
export type Intent = 'piloter' | 'saisir' | 'demandes' | 'gerer';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Rôles autorisés. Absent = tous les rôles authentifiés. */
  roles?: Role[];
  badgeKey?: 'inbox';
}

export interface NavGroup {
  intent: Intent;
  title: string;
  items: NavItem[];
}

const ADMIN: Role[] = ['tresorier', 'RG'];
const COMPTA: Role[] = ['tresorier', 'RG', 'chef'];

// Desktop : poste de pilotage trésorier, rangé par intention.
// Import (/import) et Clôture (/cloture) sont VOLONTAIREMENT absents
// (accessibles par lien direct, cf. spec).
export const DESKTOP_GROUPS: NavGroup[] = [
  {
    intent: 'piloter',
    title: 'Piloter',
    items: [
      { href: '/', label: 'Accueil', icon: Home, roles: ADMIN },
      { href: '/inbox', label: 'Inbox', icon: Inbox, roles: ADMIN, badgeKey: 'inbox' },
      { href: '/synthese', label: 'Synthèse', icon: TrendingUp, roles: COMPTA },
      { href: '/budgets', label: 'Budget', icon: Calculator, roles: COMPTA },
    ],
  },
  {
    intent: 'saisir',
    title: 'Saisir',
    items: [
      { href: '/ecritures', label: 'Écritures', icon: BookOpen, roles: ADMIN },
      { href: '/caisse', label: 'Caisse', icon: Coins, roles: ADMIN },
      { href: '/comptaweb/rapprochement', label: 'Rapprochement', icon: Link2, roles: ADMIN },
    ],
  },
  {
    intent: 'demandes',
    title: 'Demandes & dépôts',
    items: [
      { href: '/remboursements', label: 'Remboursements', icon: HandCoins, roles: ADMIN },
      { href: '/abandons', label: 'Dons au groupe', icon: Gift, roles: ADMIN },
      { href: '/depots', label: 'Dépôts', icon: Package, roles: ADMIN },
    ],
  },
  {
    intent: 'gerer',
    title: 'Gérer',
    items: [
      { href: '/moi/connexions', label: 'Connexion Claude', icon: Bot, roles: ADMIN },
      { href: '/admin/invitations', label: 'Membres', icon: Mail, roles: ADMIN },
      { href: '/admin/errors', label: 'Journal d\'erreurs', icon: ShieldAlert, roles: ADMIN },
    ],
  },
];

export interface MobileTab {
  key: 'accueil' | 'depot' | 'demandes' | 'recus' | 'plus';
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
}

// Mobile : app membre pour tous. "Déposer" est l'action reine.
export const MOBILE_TABS: MobileTab[] = [
  { key: 'accueil', href: '/', label: 'Accueil', icon: Home },
  { key: 'depot', href: '/depot', label: 'Déposer', icon: Paperclip, roles: ['tresorier', 'RG', 'chef', 'equipier'] },
  { key: 'recus', href: '/remboursements', label: 'Mes reçus', icon: FileText, roles: ['parent'] },
  { key: 'demandes', href: '/remboursements', label: 'Mes demandes', icon: HandCoins, roles: ['tresorier', 'RG', 'chef', 'equipier'] },
  { key: 'plus', href: '#plus', label: 'Plus', icon: Mail, roles: ADMIN },
];

function roleAllowed(roles: Role[] | undefined, role: string): boolean {
  return !roles || roles.includes(role as Role);
}

export function visibleItemsForRole(items: NavItem[], role: string): NavItem[] {
  return items.filter((i) => roleAllowed(i.roles, role));
}

export function visibleTabsForRole(role: string): MobileTab[] {
  // Ordre stable : accueil, depot|recus, demandes, plus.
  return MOBILE_TABS.filter((t) => roleAllowed(t.roles, role));
}
```

- [ ] **Step 4: Run le test, vérifier qu'il passe**

Run: `pnpm vitest run nav-config`
Expected: PASS (8 tests).

Note : si le test « parent » attend l'ordre `[accueil, recus]`, vérifier que `MOBILE_TABS` liste `recus` avant `demandes` — l'ordre du tableau est l'ordre d'affichage.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/layout/nav-config.ts web/src/components/layout/nav-config.test.ts
git commit -m "feat(nav): nav-config source de vérité unique (desktop intentions + mobile tabs)"
```

---

### Task 2 : Refonte `sidebar.tsx` desktop (consomme nav-config)

**Files:**
- Modify: `web/src/components/layout/sidebar.tsx`
- Reference: `web/src/components/layout/nav-config.ts` (Task 1)

- [ ] **Step 1: Remplacer le `SECTIONS` interne par `DESKTOP_GROUPS`**

Dans `sidebar.tsx`, supprimer la constante locale `SECTIONS` et les imports d'icônes désormais portés par `nav-config`. Importer depuis nav-config :

```ts
import { DESKTOP_GROUPS, visibleItemsForRole } from './nav-config';
```

- [ ] **Step 2: Adapter le rendu pour filtrer par rôle et masquer les groupes vides**

Remplacer la boucle de rendu des sections par :

```tsx
{DESKTOP_GROUPS.map((group) => {
  const items = visibleItemsForRole(group.items, role);
  if (items.length === 0) return null; // masque les groupes vides (ex: chef n'a pas "Gérer")
  return (
    <div key={group.intent} className="mt-5 first:mt-1">
      <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
        {group.title}
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink
              href={item.href}
              icon={item.icon}
              active={isActive(item.href)}
              badge={item.badgeKey ? counts[item.badgeKey] : undefined}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
})}
```

- [ ] **Step 3: Vérifier que le footer (InstallButton + SyncStatusButton + Aide) est conservé**

Le bloc footer existant reste tel quel. L'item « Aide & guide » du footer reste (en plus de sa présence éventuelle dans Gérer). Ne pas dupliquer.

- [ ] **Step 4: Run typecheck + tests existants**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: PASS. Aucun import d'icône orphelin (sinon lint warning).

- [ ] **Step 5: Vérifier visuellement (dev server)**

Run: `pnpm dev`, ouvrir `http://localhost:3000` en trésorier. Vérifier les 4 groupes d'intention dans l'ordre Piloter / Saisir / Demandes & dépôts / Gérer. Vérifier qu'Import et Clôture ne sont plus listés.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/layout/sidebar.tsx
git commit -m "feat(nav): sidebar desktop rangée par intention, filtrée par rôle"
```

---

### Task 3 : `bottom-nav.tsx` mobile membre + intégration layout

**Files:**
- Create: `web/src/components/layout/bottom-nav.tsx`
- Create: `web/src/components/layout/bottom-nav.test.tsx`
- Modify: `web/src/app/(app)/layout.tsx`

- [ ] **Step 1: Écrire le test RTL de la bottom-nav**

```tsx
// web/src/components/layout/bottom-nav.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BottomNav } from './bottom-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

afterEach(cleanup);

describe('<BottomNav>', () => {
  it('equipier voit Accueil / Déposer / Mes demandes', () => {
    render(<BottomNav role="equipier" />);
    expect(screen.getByText('Accueil')).toBeTruthy();
    expect(screen.getByText('Déposer')).toBeTruthy();
    expect(screen.getByText('Mes demandes')).toBeTruthy();
    expect(screen.queryByText('Plus')).toBeNull();
  });

  it('parent voit Mes reçus, pas Déposer', () => {
    render(<BottomNav role="parent" />);
    expect(screen.getByText('Mes reçus')).toBeTruthy();
    expect(screen.queryByText('Déposer')).toBeNull();
  });

  it('trésorier voit l onglet Plus', () => {
    render(<BottomNav role="tresorier" />);
    expect(screen.getByText('Plus')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run le test, vérifier qu'il échoue**

Run: `pnpm vitest run bottom-nav`
Expected: FAIL — `bottom-nav` n'existe pas.

- [ ] **Step 3: Implémenter `bottom-nav.tsx`**

```tsx
// web/src/components/layout/bottom-nav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { visibleTabsForRole } from './nav-config';

interface BottomNavProps {
  role: string;
  /** Callback pour ouvrir le drawer "Plus" (gestion trésorier sur mobile). */
  onOpenMore?: () => void;
}

export function BottomNav({ role, onOpenMore }: BottomNavProps) {
  const pathname = usePathname();
  const tabs = visibleTabsForRole(role);

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-bg/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Navigation principale"
    >
      <ul className="flex">
        {tabs.map((tab) => {
          const isPlus = tab.key === 'plus';
          const active = !isPlus && (tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href));
          const Icon = tab.icon;
          const inner = (
            <span className={cn('flex flex-col items-center gap-0.5 py-2', active ? 'text-brand' : 'text-fg-muted')}>
              <Icon size={20} strokeWidth={2} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </span>
          );
          return (
            <li key={tab.key} className="flex-1 text-center">
              {isPlus ? (
                <button type="button" onClick={onOpenMore} aria-label="Plus d options" className="w-full">
                  {inner}
                </button>
              ) : (
                <Link href={tab.href}>{inner}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Run le test, vérifier qu'il passe**

Run: `pnpm vitest run bottom-nav`
Expected: PASS (3 tests).

- [ ] **Step 5: Intégrer dans `(app)/layout.tsx`**

Dans le layout, la `<MobileNav>` (drawer burger) est conservée pour l'onglet « Plus » du trésorier (elle expose la sidebar complète en drawer). On ajoute la `<BottomNav>` en bas sur mobile. Comme le drawer doit s'ouvrir au clic sur « Plus », on remonte l'état d'ouverture : transformer le pattern en un wrapper client qui détient l'état.

Créer un petit composant client `mobile-shell.tsx` qui combine MobileNav (drawer) + BottomNav, ou — plus simple — passer un déclencheur. Implémentation retenue (minimale) :

```tsx
// web/src/app/(app)/layout.tsx (extrait du JSX)
import { BottomNav } from '@/components/layout/bottom-nav';
import { MobileShell } from '@/components/layout/mobile-shell';
// ...
return (
  <div className="flex flex-col lg:flex-row flex-1 min-w-0">
    {/* Mobile : top-bar + drawer + bottom-nav, état partagé */}
    <MobileShell role={ctx.role}>
      <Sidebar role={ctx.role} inboxCount={inboxCount} />
    </MobileShell>

    {/* Sidebar fixe desktop (lg+) */}
    <aside className="hidden lg:flex lg:flex-col lg:w-[260px] lg:shrink-0 border-r border-border bg-bg-sunken/60">
      <Sidebar role={ctx.role} inboxCount={inboxCount} />
    </aside>

    {/* Contenu principal — padding-bottom pour ne pas être masqué par la bottom-nav */}
    <main className="flex-1 overflow-auto px-4 py-5 lg:px-8 lg:py-7 pb-20 lg:pb-7 min-w-0">
      {children}
      <div className="max-w-6xl mx-auto">
        <HelpFooter groupId={ctx.groupId} selfEmail={ctx.email} />
      </div>
    </main>
  </div>
);
```

- [ ] **Step 6: Créer `mobile-shell.tsx` (état partagé drawer + bottom-nav)**

```tsx
// web/src/components/layout/mobile-shell.tsx
'use client';

import { useState } from 'react';
import { MobileNav } from './mobile-nav';
import { BottomNav } from './bottom-nav';

export function MobileShell({ role, children }: { role: string; children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <MobileNav open={drawerOpen} onOpenChange={setDrawerOpen}>
        {children}
      </MobileNav>
      <BottomNav role={role} onOpenMore={() => setDrawerOpen(true)} />
    </>
  );
}
```

- [ ] **Step 7: Adapter `mobile-nav.tsx` pour accepter `open`/`onOpenChange` contrôlés**

Modifier `MobileNav` : remplacer le `useState` interne par des props contrôlées `open` / `onOpenChange` (garder un fallback non-contrôlé si props absentes pour rétrocompat des tests). Le bouton burger appelle `onOpenChange(true)`, l'overlay et Échap appellent `onOpenChange(false)`.

```tsx
interface MobileNavProps {
  children: React.ReactNode;
  brand?: React.ReactNode;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}
```

Remplacer tous les `setOpen(x)` par `onOpenChange(x)` et `open` par la prop. Retirer le `useState`.

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: PASS.

- [ ] **Step 9: Vérifier visuellement mobile (dev server, responsive)**

Run: `pnpm dev`, ouvrir en viewport mobile (devtools). Vérifier la bottom-nav en bas (3 onglets equipier, +Plus trésorier), le drawer qui s'ouvre via « Plus », et que le contenu n'est pas masqué (padding-bottom).

- [ ] **Step 10: Commit**

```bash
git add web/src/components/layout/bottom-nav.tsx web/src/components/layout/bottom-nav.test.tsx web/src/components/layout/mobile-shell.tsx web/src/components/layout/mobile-nav.tsx web/src/app/\(app\)/layout.tsx
git commit -m "feat(nav): bottom-nav membre mobile + mobile-shell (drawer Plus trésorier)"
```

---

### Task 4 : Sortir Import + Clôture de la nav

**Files:**
- Reference: `web/src/components/layout/nav-config.ts` (déjà sans /import ni /cloture — fait en Task 1)
- Verify: aucune autre nav ne les liste

- [ ] **Step 1: Vérifier qu'aucun composant de nav ne référence /import ou /cloture**

Run: `grep -rn "'/import'\|'/cloture'\|\"/import\"\|\"/cloture\"" web/src/components/layout/`
Expected: aucune correspondance (Task 1 les a déjà exclus).

- [ ] **Step 2: Vérifier que les pages restent accessibles par lien direct**

Run: `ls web/src/app/\(app\)/import/page.tsx web/src/app/\(app\)/cloture/page.tsx`
Expected: les deux fichiers existent toujours (code conservé, juste hors nav).

- [ ] **Step 3: (pas de commit dédié — couvert par Task 1)**

Rien à committer ici si Task 1 a bien exclu les deux routes. Sinon, corriger nav-config et committer avec Task 1.

---

### Task 5 : Page « Connexion Claude / MCP » enrichie

**Files:**
- Modify: `web/src/app/(app)/moi/connexions/page.tsx`
- Reference: signature `listActiveTokensForUser`, `issuerUrlFromHeaders`, `revokeAction` (déjà importés dans le fichier)

- [ ] **Step 1: Réécrire le corps de la page avec le guide pas-à-pas**

Conserver les imports + `auth()` + `listActiveTokensForUser` + `mcpUrl` + la section « Apps autorisées » (avec révocation). Remplacer la section d'intro par le guide structuré :

```tsx
return (
  <main className="mx-auto max-w-3xl p-6 space-y-8">
    <header>
      <h1 className="text-2xl font-bold">🤖 Pilote ta compta depuis Claude</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Une fois Baloo connecté à Claude, tu pilotes ta trésorerie en langage naturel :
        « quelles écritures manquent un justif ? », « lance une sync », « crée la dépense de 42 € carte BNP »…
      </p>
    </header>

    <section className="rounded border-l-4 border-amber-400/60 bg-amber-50/50 p-3 text-sm">
      <strong>Prérequis</strong> — un compte Claude qui autorise les connecteurs personnalisés (Pro, Max ou Team).
    </section>

    <section className="space-y-4">
      <h2 className="font-medium">Installation en 4 étapes</h2>
      <ol className="space-y-3">
        <li className="flex gap-3">
          <span className="shrink-0 h-6 w-6 rounded-full bg-foreground text-background text-xs grid place-items-center">1</span>
          <div className="text-sm flex-1">
            Copie l&apos;URL du connecteur Baloo :
            <code className="block bg-muted p-2 rounded font-mono text-sm select-all mt-1">{mcpUrl}</code>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 h-6 w-6 rounded-full bg-foreground text-background text-xs grid place-items-center">2</span>
          <div className="text-sm">Dans Claude (web ou Desktop) : <strong>Réglages → Connecteurs → Ajouter un connecteur personnalisé</strong>. Colle l&apos;URL.</div>
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 h-6 w-6 rounded-full bg-foreground text-background text-xs grid place-items-center">3</span>
          <div className="text-sm">Claude te renvoie sur Baloo → <strong>autorise l&apos;accès</strong> (login OAuth).</div>
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 h-6 w-6 rounded-full bg-foreground text-background text-xs grid place-items-center">4</span>
          <div className="text-sm">Teste : tape dans Claude <em>« Montre-moi la vue d&apos;ensemble de la trésorerie »</em>. ✅</div>
        </li>
      </ol>
    </section>

    <section className="space-y-2">
      <h2 className="font-medium">Que demander à Claude</h2>
      <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
        <li>« Quelles écritures n&apos;ont pas encore de justificatif ? »</li>
        <li>« Lance une synchronisation avec Comptaweb. »</li>
        <li>« Montre-moi les remboursements en attente. »</li>
        <li>« Crée une dépense de 42,50 € carte BNP pour les achats du week-end. »</li>
      </ul>
    </section>

    {/* Section "Apps autorisées" existante, inchangée — conserver le bloc tokens + révocation */}
  </main>
);
```

- [ ] **Step 2: Uniformiser le wording « Claude Desktop » → « Claude (web ou Desktop) »**

Vérifier qu'il ne reste aucune mention « Claude Desktop » seule dans la page.

- [ ] **Step 3: Run typecheck + vérif visuelle**

Run: `pnpm tsc --noEmit`
Expected: PASS. Puis `pnpm dev`, ouvrir `/moi/connexions` en trésorier : guide + prompts + apps connectées.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(app\)/moi/connexions/page.tsx
git commit -m "feat(mcp): page Connexion Claude en guide pas-à-pas + exemples de prompts"
```

---

## PHASE B — Formulaires unifiés

### Task 6 : Formulaire remboursement unifié

**Files:**
- Modify: `web/src/components/rembs/remboursement-form.tsx` (un seul `identityMode`)
- Modify: `web/src/lib/actions/remboursements/create.ts` (une action `createRemboursement`)
- Modify: `web/src/app/(app)/remboursements/nouveau/page.tsx` (formulaire unifié, demandeur prérempli)
- Delete: `web/src/app/(app)/moi/remboursements/` (dossier)
- Modify (liens) : `web/src/app/(app)/remboursements/page.tsx:52,88`, `web/src/app/(app)/page.tsx` (Cta), `web/src/app/(app)/aide/page.tsx:59`

- [ ] **Step 1: Écrire/adapter le test de l'action unifiée**

Localiser les tests existants de `createMyRemboursement` / `createForeignRemboursement` (probablement `web/src/lib/actions/remboursements/__tests__/`). Écrire le test cible :

```ts
// test : createRemboursement prérempli mais demandeur modifiable
it('crée avec le demandeur du formData (modifiable)', async () => {
  const fd = makeFormData({ prenom: 'Marie', nom: 'Durand', email: 'marie@x.fr', montant: '42,00', /* ... */ });
  await createRemboursement(fd);
  const row = await getLastRemboursement();
  expect(row.demandeur_prenom).toBe('Marie');
});

it('utilise l identité connectée si le formData ne surcharge pas', async () => {
  // demandeur prérempli côté page = ctx ; ici on simule le submit tel quel
  const fd = makeFormData({ prenom: ctxName, /* ... */ });
  await createRemboursement(fd);
  // assertion sur la valeur prérempli
});
```

- [ ] **Step 2: Run le test, vérifier qu'il échoue**

Run: `pnpm vitest run remboursements`
Expected: FAIL — `createRemboursement` n'existe pas encore.

- [ ] **Step 3: Fusionner les deux actions en `createRemboursement`**

Dans `web/src/lib/actions/remboursements/create.ts` : créer `createRemboursement(formData)` qui reprend la logique de `createForeignRemboursement` (lit prenom/nom/email du formData) — c'est le cas général, le préremplissage se fait côté page. Supprimer `createMyRemboursement` et `createForeignRemboursement` une fois qu'aucun caller ne les utilise. Retirer la restriction de rôle `['tresorier','RG','chef']` (le formulaire est ouvert à tous, demandeur modifiable — cf. spec § décision assumée). Mettre à jour le `backUrl` de redirection d'erreur (ligne ~244) vers `/remboursements/nouveau`.

- [ ] **Step 4: Simplifier `remboursement-form.tsx` (un seul mode)**

Retirer la prop `identityMode`. Les champs prénom/nom/email sont toujours des inputs **éditables**, préremplis via des props `defaultPrenom`/`defaultNom`/`defaultEmail`. Supprimer le mode `locked` (hidden inputs). Conserver l'auto-remplissage du dernier RIB.

- [ ] **Step 5: Réécrire `remboursements/nouveau/page.tsx`**

Server Component qui : récupère `ctx` (user connecté), précharge le dernier RIB, rend `<RemboursementForm action={createRemboursement} defaultPrenom={...} defaultNom={...} defaultEmail={...} />`. Retirer le garde `requireNotParent` trop strict si la spec ouvre à tous ; sinon conserver l'exclusion `parent` (un parent n'a pas vocation à créer une demande). **Décision** : conserver l'exclusion `parent` (cohérent avec son onglet « Mes reçus » en consultation).

- [ ] **Step 6: Supprimer `/moi/remboursements/` et mettre à jour les liens entrants**

```bash
rm -r web/src/app/\(app\)/moi/remboursements
```

Mettre à jour vers `/remboursements/nouveau` :
- `web/src/app/(app)/remboursements/nouveau/page.tsx:42` (Link)
- `web/src/app/(app)/remboursements/page.tsx:52,88` (2 Links)
- `web/src/app/(app)/page.tsx` (objet Cta `href`)
- `web/src/app/(app)/aide/page.tsx:59` (CodeLink texte)

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: PASS. Aucune référence résiduelle :
Run: `grep -rn "moi/remboursements" web/src` → attendu : vide.

- [ ] **Step 8: Vérif visuelle (dev server)**

Tester `/remboursements/nouveau` en equipier (demandeur prérempli, modifiable) et en trésorier (idem). Soumettre une demande, vérifier la création.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(rembs): formulaire remboursement unifié (demandeur prérempli modifiable)"
```

---

### Task 7 : Formulaire abandon unifié

**Files:**
- Create: `web/src/components/abandons/abandon-form.tsx` (extrait des 2 formulaires inline)
- Modify: `web/src/lib/actions/abandons.ts` (une action `createAbandon`)
- Modify: `web/src/app/(app)/abandons/nouveau/page.tsx`
- Delete: `web/src/app/(app)/moi/abandons/` (dossier)
- Modify (liens) : `web/src/app/(app)/abandons/page.tsx:98`, `web/src/app/(app)/page.tsx` (Cta), `web/src/app/(app)/aide/page.tsx:93`

- [ ] **Step 1: Écrire le test de l'action unifiée `createAbandon`**

```ts
it('crée un abandon avec le donateur du formData', async () => {
  const fd = makeFormData({ prenom: 'Paul', nom: 'Martin', email: 'paul@x.fr', montant: '100,00', /* ... */ });
  await createAbandon(fd);
  const row = await getLastAbandon();
  expect(row.donateur_prenom).toBe('Paul');
});
```

- [ ] **Step 2: Run le test, vérifier qu'il échoue**

Run: `pnpm vitest run abandons`
Expected: FAIL — `createAbandon` n'existe pas.

- [ ] **Step 3: Extraire `abandon-form.tsx` depuis les 2 formulaires inline**

Créer un composant client `AbandonForm` qui rend les champs partagés (montant, intitulé, année fiscale, …) + prénom/nom/email **éditables** préremplis via props. S'inspirer des deux `<form>` inline existants (`abandons/nouveau/page.tsx:45-150` et `moi/abandons/nouveau/page.tsx:100-190`) en gardant le superset des champs.

- [ ] **Step 4: Fusionner les actions en `createAbandon`**

Dans `web/src/lib/actions/abandons.ts` : créer `createAbandon(formData)` reprenant la logique de `createAbandonForOther` (lit donateur du formData). Supprimer `createMyAbandon` et `createAbandonForOther`. Mettre à jour les 7 redirects d'erreur (lignes 91,99,116,127,131,138,176) vers `/abandons/nouveau?error=`.

- [ ] **Step 5: Réécrire `abandons/nouveau/page.tsx`**

Server Component qui récupère `ctx`, rend `<AbandonForm action={createAbandon} defaultPrenom={...} ... />`. Conserver l'exclusion `parent` (cohérence avec rembs).

- [ ] **Step 6: Supprimer `/moi/abandons/` et mettre à jour les liens**

```bash
rm -r web/src/app/\(app\)/moi/abandons
```

Mettre à jour vers `/abandons/nouveau` :
- `web/src/app/(app)/abandons/page.tsx:98` (Link)
- `web/src/app/(app)/page.tsx` (Cta `href`)
- `web/src/app/(app)/aide/page.tsx:93` (CodeLink texte)

- [ ] **Step 7: Run tests + typecheck + grep résiduel**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Run: `grep -rn "moi/abandons" web/src` → attendu : vide.
Expected: PASS.

- [ ] **Step 8: Vérif visuelle**

Tester `/abandons/nouveau` en equipier et trésorier. Soumettre, vérifier la création + génération du reçu.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(abandons): formulaire abandon unifié + composant AbandonForm partagé"
```

---

### Task 8 : ADR + vérification end-to-end + nettoyage

**Files:**
- Modify: `doc/decisions.md` (ADR-033)
- Verify: ensemble du flow

- [ ] **Step 1: Vérification end-to-end (dev server, desktop + mobile)**

1. `pnpm dev`.
2. **Desktop trésorier** : 4 groupes d'intention, pas d'Import/Clôture, page Connexion Claude OK.
3. **Mobile equipier** (devtools responsive) : bottom-nav 3 onglets, déposer un justif, voir mes demandes.
4. **Mobile trésorier** : bottom-nav + onglet « Plus » → drawer sidebar complète.
5. **Mobile parent** : onglet « Mes reçus », pas de « Déposer ».
6. **Formulaires** : `/remboursements/nouveau` et `/abandons/nouveau` préremplis et modifiables, en equipier ET trésorier.
7. `/admin/errors` : aucune nouvelle erreur.

- [ ] **Step 2: Écrire l'ADR-033**

Ajouter dans `doc/decisions.md` un ADR capturant les 4 décisions (cf. spec § « Décisions structurantes à acter ») : viewport décide l'expérience / mobile = membre / app trésorier par intention / formulaires unifiés. Référencer spec + plan.

- [ ] **Step 3: Vérif finale tests + build + lint**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm next build`
Expected: tous PASS, build OK.

- [ ] **Step 4: Commit final**

```bash
git add doc/decisions.md
git commit -m "doc(adr): ADR-033 refonte navigation (clôture)"
```

- [ ] **Step 5: Demander accord push à l'utilisateur**

Memory `feedback_pas_de_push_sans_accord` : Vercel déploie auto sur push to main. Demander avant de pusher. Vérifier en particulier qu'aucune migration BDD n'est en jeu (ici : aucune, refonte front pure) — risque cold-start nul.

---

## Self-review (couverture spec)

- **Deux expériences (viewport/rôle)** → Tasks 1-3 (nav-config + sidebar + bottom-nav + layout). ✓
- **App membre mobile bottom-nav** → Task 3. ✓
- **App trésorier par intention** → Tasks 1-2. ✓
- **Trésorier mobile = membre + Plus** → Task 3 (mobile-shell + onglet plus). ✓
- **Variantes rôle (parent/chef)** → Task 1 (MOBILE_TABS) + tests. ✓
- **Page MCP guide + prompts** → Task 5. ✓
- **Import/Clôture hors nav** → Tasks 1 & 4. ✓
- **Formulaires rembs unifiés** → Task 6. ✓
- **Formulaires abandons unifiés** → Task 7. ✓
- **Suppression routes /moi/... + maj liens** → Tasks 6 & 7 (liste exacte des fichiers issue de la cartographie). ✓
- **ADR** → Task 8. ✓

Note : la carte « Mon unité » du chef (mobile) est hors scope (spec § non-objectifs) — pas de task, l'emplacement est juste prévu dans l'écran Accueil membre, à câbler dans un chantier ultérieur.
