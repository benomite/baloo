# Dashboard trésorier (home `/`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au trésorier (`tresorier` / `RG`) une home `/` de pilotage à deux blocs — « à traiter » (actions) en haut, « santé » (chiffres) en dessous — au lieu de la redirection actuelle vers `/ecritures`.

**Architecture:** Une couche données `getDashboardData(ctx)` agrège `getOverview()` (réutilisé), `getSyncStatus()` et 3 compteurs SQL nouveaux (dépôts à rapprocher, abandons à traiter, drafts bancaires). Un composant serveur `treasurer-dashboard.tsx` rend les deux blocs avec les composants design system existants. `page.tsx` route admin → dashboard, chef/membre → home didactique inchangée.

**Tech Stack:** Next.js 16 (App Router, server components), libsql/Turso, vitest. Spec source : `doc/specs/2026-06-24-dashboard-tresorier-design.md`.

## Global Constraints

- **JAMAIS de DELETE** sur les tables métier ; ici tout est lecture seule (COUNT/SELECT). Aucune mutation.
- **Pas de seuils paramétrables** en V1 : coloration uniquement sur `count > 0` / dépassement budget / sync stale.
- **`categories` n'a pas de `group_id`** (référentiel national) — non concerné ici, mais ne jamais filtrer dessus.
- **`depots_justificatifs` est lazy-init** (`ensureDepotsSchema()`) : toute query directe doit l'appeler avant (cf. `web/AGENTS.md`).
- **`export const dynamic = 'force-dynamic'`** déjà en place dans `page.tsx` — conserver.
- **Pas de CHECK SQL** ajouté ; pas de migration de schéma (on lit des tables existantes).
- **Pas de push sans accord** : commit local OK, push à demander.
- Montants en **centimes** en base, formatés via `formatAmount(cents)` (`src/lib/format.ts`).
- Tests BDD : **in-memory** (`createClient({ url: 'file::memory:' })`), jamais `data/baloo.db`.

---

## File Structure

- **Create** `web/src/lib/services/dashboard-counts.ts` — 3 fonctions de comptage SQL pures-injection (`(db, groupId) => Promise<number>`).
- **Create** `web/src/lib/services/__tests__/dashboard-counts.test.ts` — tests in-memory des 3 compteurs.
- **Create** `web/src/lib/services/dashboard.ts` — type `DashboardData`, `getDashboardData(ctx)` (orchestration), helper pur `isAllClear(aTraiter)`.
- **Create** `web/src/lib/services/__tests__/dashboard.test.ts` — tests purs de `isAllClear`.
- **Create** `web/src/components/dashboard/treasurer-dashboard.tsx` — composant serveur, rend les 2 blocs.
- **Modify** `web/src/app/(app)/page.tsx` — retirer `redirect('/ecritures')`, brancher le dashboard pour les rôles admin.

---

## Task 1 : Compteurs SQL (`dashboard-counts.ts`)

**Files:**
- Create: `web/src/lib/services/dashboard-counts.ts`
- Test: `web/src/lib/services/__tests__/dashboard-counts.test.ts`

**Interfaces:**
- Consumes: `DbWrapper` (`web/src/lib/db.ts`).
- Produces:
  - `countDepotsATraiter(db: DbWrapper, groupId: string): Promise<number>` — dépôts justificatifs `statut = 'a_traiter'`.
  - `countAbandonsATraiter(db: DbWrapper, groupId: string): Promise<number>` — abandons `status IN ('a_traiter','valide')`.
  - `countDraftsBancaires(db: DbWrapper, groupId: string): Promise<number>` — écritures `status = 'draft' AND ligne_bancaire_id IS NOT NULL`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/services/__tests__/dashboard-counts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';
import {
  countDepotsATraiter,
  countAbandonsATraiter,
  countDraftsBancaires,
} from '../dashboard-counts';

const SETUP_SQL = `
  CREATE TABLE depots_justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'a_traiter'
  );
  CREATE TABLE abandons_frais (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'a_traiter'
  );
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    ligne_bancaire_id INTEGER
  );
`;

async function setupDb() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  return wrapClient(client);
}

describe('dashboard-counts', () => {
  let db: Awaited<ReturnType<typeof setupDb>>;

  beforeEach(async () => {
    db = await setupDb();
  });

  it('countDepotsATraiter ne compte que les statuts a_traiter du groupe', async () => {
    await db.prepare("INSERT INTO depots_justificatifs (id, group_id, statut) VALUES (?, ?, ?)").run('d1', 'g1', 'a_traiter');
    await db.prepare("INSERT INTO depots_justificatifs (id, group_id, statut) VALUES (?, ?, ?)").run('d2', 'g1', 'rattache');
    await db.prepare("INSERT INTO depots_justificatifs (id, group_id, statut) VALUES (?, ?, ?)").run('d3', 'g2', 'a_traiter');
    expect(await countDepotsATraiter(db, 'g1')).toBe(1);
  });

  it('countAbandonsATraiter compte a_traiter + valide', async () => {
    await db.prepare("INSERT INTO abandons_frais (id, group_id, status) VALUES (?, ?, ?)").run('a1', 'g1', 'a_traiter');
    await db.prepare("INSERT INTO abandons_frais (id, group_id, status) VALUES (?, ?, ?)").run('a2', 'g1', 'valide');
    await db.prepare("INSERT INTO abandons_frais (id, group_id, status) VALUES (?, ?, ?)").run('a3', 'g1', 'envoye_national');
    expect(await countAbandonsATraiter(db, 'g1')).toBe(2);
  });

  it('countDraftsBancaires ne compte que les drafts liés à une ligne bancaire', async () => {
    await db.prepare("INSERT INTO ecritures (id, group_id, status, ligne_bancaire_id) VALUES (?, ?, ?, ?)").run('e1', 'g1', 'draft', 42);
    await db.prepare("INSERT INTO ecritures (id, group_id, status, ligne_bancaire_id) VALUES (?, ?, ?, ?)").run('e2', 'g1', 'draft', null);
    await db.prepare("INSERT INTO ecritures (id, group_id, status, ligne_bancaire_id) VALUES (?, ?, ?, ?)").run('e3', 'g1', 'mirror', 43);
    expect(await countDraftsBancaires(db, 'g1')).toBe(1);
  });

  it('renvoie 0 sur tables vides', async () => {
    expect(await countDepotsATraiter(db, 'g1')).toBe(0);
    expect(await countAbandonsATraiter(db, 'g1')).toBe(0);
    expect(await countDraftsBancaires(db, 'g1')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/dashboard-counts.test.ts`
Expected: FAIL — `Cannot find module '../dashboard-counts'`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/services/dashboard-counts.ts`:

```ts
// Compteurs SQL du dashboard trésorier (Phase 4 pivot miroir).
// Fonctions à injection de `db` → testables in-memory (cf. db.ts wrapClient).
// Lecture seule : aucun DELETE/UPDATE (cf. règle CLAUDE.md).
import type { DbWrapper } from '../db';

export async function countDepotsATraiter(db: DbWrapper, groupId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM depots_justificatifs WHERE group_id = ? AND statut = 'a_traiter'")
    .get<{ count: number }>(groupId);
  return row?.count ?? 0;
}

export async function countAbandonsATraiter(db: DbWrapper, groupId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM abandons_frais WHERE group_id = ? AND status IN ('a_traiter', 'valide')")
    .get<{ count: number }>(groupId);
  return row?.count ?? 0;
}

export async function countDraftsBancaires(db: DbWrapper, groupId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM ecritures WHERE group_id = ? AND status = 'draft' AND ligne_bancaire_id IS NOT NULL")
    .get<{ count: number }>(groupId);
  return row?.count ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/dashboard-counts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/dashboard-counts.ts web/src/lib/services/__tests__/dashboard-counts.test.ts
git commit -m "feat(dashboard): compteurs SQL dépôts/abandons/drafts à traiter"
```

---

## Task 2 : Couche données (`dashboard.ts`)

**Files:**
- Create: `web/src/lib/services/dashboard.ts`
- Test: `web/src/lib/services/__tests__/dashboard.test.ts`

**Interfaces:**
- Consumes:
  - `getOverview(ctx)` → `OverviewData` (`web/src/lib/services/overview.ts`) : `.solde`, `.soldeFormatted`, `.parUnite[]`, `.remboursementsEnAttente {count,total,totalFormatted}`, `.alertes {depensesSansJustificatif, nonSyncComptaweb}`.
  - `getSyncStatus(db, groupId)` → `{ stale, is_running, last_run }` (`web/src/lib/services/sync-cycle.ts`).
  - `ensureDepotsSchema()` (`web/src/lib/services/depots.ts`).
  - `countDepotsATraiter`, `countAbandonsATraiter`, `countDraftsBancaires` (Task 1).
  - `getDb()` (`web/src/lib/db.ts`), `formatAmount` (`web/src/lib/format.ts`).
  - `CurrentContext` (`web/src/lib/context.ts`) : `{ groupId, ... }`.
- Produces:
  - `interface DashboardData` (voir code).
  - `getDashboardData(ctx: { groupId: string }): Promise<DashboardData>`.
  - `isAllClear(aTraiter: DashboardData['aTraiter']): boolean`.

- [ ] **Step 1: Write the failing test** (helper pur `isAllClear`)

Create `web/src/lib/services/__tests__/dashboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAllClear } from '../dashboard';

const base = {
  rembs: { count: 0, totalCents: 0 },
  depotsARapprocher: 0,
  depensesSansJustif: 0,
  abandonsATraiter: 0,
  draftsBancaires: 0,
};

describe('isAllClear', () => {
  it('renvoie true quand tous les compteurs sont à zéro', () => {
    expect(isAllClear(base)).toBe(true);
  });

  it('renvoie false dès qu un compteur est non nul', () => {
    expect(isAllClear({ ...base, depotsARapprocher: 1 })).toBe(false);
    expect(isAllClear({ ...base, rembs: { count: 2, totalCents: 5000 } })).toBe(false);
    expect(isAllClear({ ...base, draftsBancaires: 3 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/dashboard.test.ts`
Expected: FAIL — `Cannot find module '../dashboard'`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/services/dashboard.ts`:

```ts
// Couche données du dashboard trésorier (Phase 4 pivot miroir).
// Réutilise getOverview (trésorerie, rembs en attente, alertes justif/sync)
// + getSyncStatus + 3 compteurs dédiés. Lecture seule, une passe parallèle.
import { getDb } from '../db';
import { getOverview } from './overview';
import { getSyncStatus } from './sync-cycle';
import { ensureDepotsSchema } from './depots';
import {
  countDepotsATraiter,
  countAbandonsATraiter,
  countDraftsBancaires,
} from './dashboard-counts';

export interface DashboardData {
  aTraiter: {
    rembs: { count: number; totalCents: number };
    depotsARapprocher: number;
    depensesSansJustif: number;
    abandonsATraiter: number;
    draftsBancaires: number;
  };
  sante: {
    soldeCents: number;
    soldeFormatted: string;
    engagementRembsCents: number;
    engagementRembsFormatted: string;
    nonSyncComptaweb: number;
    parUnite: Awaited<ReturnType<typeof getOverview>>['parUnite'];
    sync: { stale: boolean; isRunning: boolean; lastRunAt: string | null };
  };
}

export function isAllClear(aTraiter: DashboardData['aTraiter']): boolean {
  return (
    aTraiter.rembs.count === 0 &&
    aTraiter.depotsARapprocher === 0 &&
    aTraiter.depensesSansJustif === 0 &&
    aTraiter.abandonsATraiter === 0 &&
    aTraiter.draftsBancaires === 0
  );
}

export async function getDashboardData(ctx: { groupId: string }): Promise<DashboardData> {
  const db = getDb();
  await ensureDepotsSchema(); // table lazy-init — cf. web/AGENTS.md

  const [overview, sync, depots, abandons, drafts] = await Promise.all([
    getOverview({ groupId: ctx.groupId }),
    getSyncStatus(db, ctx.groupId),
    countDepotsATraiter(db, ctx.groupId),
    countAbandonsATraiter(db, ctx.groupId),
    countDraftsBancaires(db, ctx.groupId),
  ]);

  return {
    aTraiter: {
      rembs: {
        count: overview.remboursementsEnAttente.count,
        totalCents: overview.remboursementsEnAttente.total,
      },
      depotsARapprocher: depots,
      depensesSansJustif: overview.alertes.depensesSansJustificatif,
      abandonsATraiter: abandons,
      draftsBancaires: drafts,
    },
    sante: {
      soldeCents: overview.solde,
      soldeFormatted: overview.soldeFormatted,
      engagementRembsCents: overview.remboursementsEnAttente.total,
      engagementRembsFormatted: overview.remboursementsEnAttente.totalFormatted,
      nonSyncComptaweb: overview.alertes.nonSyncComptaweb,
      parUnite: overview.parUnite,
      sync: {
        stale: sync.stale,
        isRunning: sync.is_running,
        lastRunAt: sync.last_run?.started_at ?? null,
      },
    },
  };
}
```

> Note implémenteur : vérifier le nom exact du champ timestamp de `SyncRunRow` (`started_at`). S'il diffère, ajuster `lastRunAt`. `pnpm tsc --noEmit` le révèle (Step 5).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/dashboard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd web && pnpm tsc --noEmit`
Expected: pas d'erreur sur `dashboard.ts` / `dashboard-counts.ts`. Corriger les noms de champs si `tsc` signale (ex. `started_at`).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/services/dashboard.ts web/src/lib/services/__tests__/dashboard.test.ts
git commit -m "feat(dashboard): getDashboardData — agrégation overview + sync + compteurs"
```

---

## Task 3 : UI dashboard + routing (`treasurer-dashboard.tsx`, `page.tsx`)

**Files:**
- Create: `web/src/components/dashboard/treasurer-dashboard.tsx`
- Modify: `web/src/app/(app)/page.tsx` (retirer `redirect('/ecritures')` ligne ~64 ; brancher le dashboard pour `ADMIN_ROLES`)

**Interfaces:**
- Consumes: `getDashboardData`, `isAllClear`, `DashboardData` (Task 2) ; `Section`, `SectionHeader` (`web/src/components/shared/section.tsx`) ; `Amount` (`web/src/components/shared/amount.tsx`) ; `formatAmount` ; icônes `lucide-react`.
- Produces: `TreasurerDashboard({ data }: { data: DashboardData })` — composant serveur.

Cette tâche est **UI** : pas de test automatisé (pas d'E2E dans ce repo). Vérification manuelle en fin de tâche.

- [ ] **Step 1: Créer le composant dashboard**

Create `web/src/components/dashboard/treasurer-dashboard.tsx` :

```tsx
import Link from 'next/link';
import {
  HandCoins, Paperclip, FileWarning, Gift, Landmark,
  Wallet, PiggyBank, RefreshCw, CheckCircle2, ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { Section } from '@/components/shared/section';
import { Amount } from '@/components/shared/amount';
import { isAllClear, type DashboardData } from '@/lib/services/dashboard';
import { cn } from '@/lib/utils';

interface ActionItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  count: number;
  totalCents?: number;
}

export function TreasurerDashboard({ data }: { data: DashboardData }) {
  const { aTraiter, sante } = data;
  const allClear = isAllClear(aTraiter);

  const actions: ActionItem[] = [
    { key: 'rembs', label: 'Remboursements à traiter', href: '/remboursements?status=demande', icon: HandCoins, count: aTraiter.rembs.count, totalCents: aTraiter.rembs.totalCents },
    { key: 'depots', label: 'Dépôts membres à rapprocher', href: '/depots', icon: Paperclip, count: aTraiter.depotsARapprocher },
    { key: 'justif', label: 'Dépenses sans justificatif', href: '/inbox', icon: FileWarning, count: aTraiter.depensesSansJustif },
    { key: 'abandons', label: 'Abandons à traiter', href: '/abandons', icon: Gift, count: aTraiter.abandonsATraiter },
    { key: 'banque', label: 'Lignes bancaires non rapprochées', href: '/comptaweb/rapprochement', icon: Landmark, count: aTraiter.draftsBancaires },
  ].filter((a) => a.count > 0);

  return (
    <div className="space-y-8">
      <Section title="À traiter" subtitle={allClear ? undefined : 'Ce qui attend ton action.'}>
        {allClear ? (
          <div className="flex items-center gap-2.5 px-6 py-5 text-fg-muted">
            <CheckCircle2 size={18} strokeWidth={1.75} className="text-emerald-600" />
            <span className="text-[13.5px]">Tout est à jour — rien n&apos;attend ton action.</span>
          </div>
        ) : (
          <ul className="divide-y divide-border-soft">
            {actions.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="flex items-center gap-3 px-6 py-3 hover:bg-brand-50/40 transition-colors">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                    <a.icon size={15} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-fg">{a.label}</div>
                    {a.totalCents != null && a.totalCents > 0 && (
                      <div className="text-[12px] text-fg-muted">
                        Total : <Amount cents={a.totalCents} />
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100 text-[13px] font-semibold tabular-nums">
                    {a.count}
                  </span>
                  <ArrowRight size={14} strokeWidth={2} className="text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Santé du groupe" subtitle="Photo de l'exercice en cours.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-6 py-5">
          <HealthCard icon={Wallet} label="Trésorerie" href="/ecritures">
            <Amount cents={sante.soldeCents} />
          </HealthCard>
          <HealthCard icon={PiggyBank} label="Engagement remboursements" href="/remboursements">
            <Amount cents={sante.engagementRembsCents} />
          </HealthCard>
          <HealthCard icon={RefreshCw} label="Sync Comptaweb" href="/comptaweb/rapprochement"
            tone={sante.sync.stale ? 'warn' : 'ok'}>
            {sante.sync.isRunning ? 'En cours…' : sante.sync.stale ? 'À resynchroniser' : 'À jour'}
            {sante.nonSyncComptaweb > 0 && ` · ${sante.nonSyncComptaweb} non synchro`}
          </HealthCard>
          <HealthCard icon={Landmark} label="Budgets par unité" href="/budgets">
            {sante.parUnite.filter((u) => u.budget_prevu_depenses > 0 && u.depenses > u.budget_prevu_depenses).length > 0
              ? `${sante.parUnite.filter((u) => u.budget_prevu_depenses > 0 && u.depenses > u.budget_prevu_depenses).length} dépassement(s)`
              : 'Dans les clous'}
          </HealthCard>
        </div>
      </Section>
    </div>
  );
}

function HealthCard({
  icon: Icon, label, href, tone = 'neutral', children,
}: {
  icon: LucideIcon; label: string; href: string;
  tone?: 'neutral' | 'ok' | 'warn'; children: React.ReactNode;
}) {
  return (
    <Link href={href} className="group flex flex-col gap-1.5 rounded-xl border border-border bg-bg-elevated p-4 hover:border-brand-100 hover:bg-brand-50/40 transition-colors">
      <div className="flex items-center gap-2 text-fg-muted">
        <Icon size={14} strokeWidth={1.75} />
        <span className="text-[12px] font-medium">{label}</span>
      </div>
      <div className={cn(
        'text-[16px] font-semibold tabular-nums text-fg',
        tone === 'warn' && 'text-amber-700 dark:text-amber-300',
      )}>
        {children}
      </div>
    </Link>
  );
}
```

> Note implémenteur : vérifier que les icônes Lucide importées existent (`FileWarning`, `Landmark`, `PiggyBank` sont standard). Remplacer si `tsc` signale un import manquant.

- [ ] **Step 2: Brancher le dashboard dans `page.tsx`**

Dans `web/src/app/(app)/page.tsx`, **remplacer** la ligne :

```ts
  if (ADMIN_ROLES.includes(ctx.role)) redirect('/ecritures');
```

par :

```ts
  if (ADMIN_ROLES.includes(ctx.role)) {
    const data = await getDashboardData({ groupId: ctx.groupId });
    return (
      <div className="max-w-5xl mx-auto">
        <PageHeader
          title={`Bonjour ${firstName(ctx.name, ctx.email)}`}
          subtitle="Voici l'état de la trésorerie et ce qui attend ton action."
        />
        <TreasurerDashboard data={data} />
      </div>
    );
  }
```

Ajouter en tête de fichier les imports :

```ts
import { getDashboardData } from '@/lib/services/dashboard';
import { TreasurerDashboard } from '@/components/dashboard/treasurer-dashboard';
```

Retirer l'import `redirect` s'il n'est plus utilisé ailleurs dans le fichier (`tsc`/eslint le signalera).

- [ ] **Step 3: Typecheck + lint**

Run: `cd web && pnpm tsc --noEmit && pnpm lint`
Expected: aucune erreur. Corriger imports inutilisés / icônes manquantes le cas échéant.

- [ ] **Step 4: Vérification manuelle (dev server)**

Run: `cd web && pnpm dev`
Puis se connecter avec un compte `tresorier` et ouvrir `/` :
- Le bloc « À traiter » liste les cartes à `count > 0` (ou « Tout est à jour » si rien).
- Le bloc « Santé » affiche trésorerie, engagement rembs, sync, budgets.
- Chaque carte mène à la bonne page (`/remboursements?status=demande`, `/depots`, `/inbox`, `/abandons`, `/comptaweb/rapprochement`, `/budgets`).
- Se connecter avec un compte `chef` → la home didactique est **inchangée**.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dashboard/treasurer-dashboard.tsx web/src/app/\(app\)/page.tsx
git commit -m "feat(dashboard): home trésorier deux blocs (à traiter / santé)"
```

---

## Self-Review (auteur)

**Spec coverage :**
- Routing admin → dashboard, chef/membre inchangé ✅ (Task 3).
- Couche `getDashboardData` réutilisant getOverview ✅ (Task 2).
- 3 compteurs nouveaux ✅ (Task 1).
- Bloc « à traiter » : rembs, dépôts, dépenses sans justif, abandons, lignes banque ✅ (Task 3).
- Bloc « santé » : trésorerie, engagement rembs, budgets unité, sync CW ✅ (Task 3).
- Hiérarchie « ce qui va / pas » : cartes count>0 mises en avant, allClear compact, dépassement/stale colorés ✅ (Task 3).
- Error handling : `getDashboardData` lecture seule + `Promise.all` ; si robustesse insuffisante en prod, wrapper par `logError` (cf. AGENTS.md) — non bloquant V1.
- Tests : compteurs in-memory + helper pur ✅ ; vérif manuelle prod-like ✅.
- Point ouvert « dépenses sans justif » → tranché : destination `/inbox`.

**Placeholders :** aucun TODO/TBD ; code complet à chaque step.

**Type consistency :** `DashboardData.aTraiter` (rembs/depotsARapprocher/depensesSansJustif/abandonsATraiter/draftsBancaires) cohérent entre Task 2 (def), `isAllClear` et Task 3 (conso). Compteurs Task 1 ↔ Task 2 : noms identiques (`countDepotsATraiter`, `countAbandonsATraiter`, `countDraftsBancaires`). Deux noms de champs externes à confirmer au `tsc` : `SyncRunRow.started_at`, icônes Lucide — notés inline.
