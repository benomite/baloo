# Synthèse enrichie + détail par unité — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la table « Par unité » de `/synthese` par une grille de cartes couleur SGDF cliquables, ajouter une page détail `/synthese/unite/[id]`, et signaler la couverture `unite_id` (écritures/remb/caisse sans unité).

**Architecture:** Pure UI + 1 fonction service additionnelle (`getUniteOverview`). Aucun changement de schéma BDD. Tout en server components Next 16. Filtre `sans_unite=1` ajouté à `/ecritures` pour drill-down audit.

**Tech Stack:** Next 16 (App Router, server components, `force-dynamic`), libsql/Turso, Tailwind, lucide-react. Aucune nouvelle dépendance.

**Spec source :** [`doc/specs/2026-05-10-synthese-detail-par-unite-design.md`](../specs/2026-05-10-synthese-detail-par-unite-design.md)

**Tests :** Pas de tests unitaires en phase 1 — le pattern projet (cf. `web/src/lib/services/*-transitions.test.ts`) ne couvre que les fonctions pures, pas les services BDD-coupled. Vérifications manuelles documentées à chaque tâche.

---

## File Structure

**Modifié :**
- `web/src/lib/services/overview.ts` — ajoute compteurs « sans unité » + nouvelle fonction `getUniteOverview`
- `web/src/lib/queries/overview.ts` — re-exporte la nouvelle fonction
- `web/src/lib/services/ecritures.ts` — ajoute filtre `sans_unite` à `EcritureFilters`
- `web/src/app/(app)/ecritures/page.tsx` — lit `params.sans_unite` + tab « Sans unité »
- `web/src/app/(app)/synthese/page.tsx` — remplace la table « Par unité » par `<UnitesGrid>`, ajoute la stat card « Sans unité »

**Créé :**
- `web/src/components/synthese/unite-card.tsx` — carte couleur cliquable
- `web/src/components/synthese/unites-grid.tsx` — grille responsive
- `web/src/app/(app)/synthese/unite/[id]/page.tsx` — page détail
- `web/src/app/(app)/synthese/unite/[id]/not-found.tsx` — message 404 dédié

---

## Task 1 — Filtre `sans_unite` côté service `listEcritures`

**Files:**
- Modify: `web/src/lib/services/ecritures.ts:13-32` (interface `EcritureFilters`) et `web/src/lib/services/ecritures.ts:64-130` (fonction `listEcritures`)

- [ ] **Step 1 : Ajouter `sans_unite` à `EcritureFilters`**

Dans `web/src/lib/services/ecritures.ts`, repérer l'interface `EcritureFilters` (autour de la ligne 13-32) et ajouter la propriété :

```ts
export interface EcritureFilters {
  // …champs existants…
  incomplete?: boolean;
  from_bank?: boolean;
  sans_unite?: boolean; // NEW
  search?: string;
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 2 : Implémenter le filtre dans la query**

Dans la même fonction `listEcritures`, juste après les filtres existants `unite_id` / `category_id` / etc. (autour de la ligne 75-86), ajouter :

```ts
if (filters.sans_unite) {
  conditions.push('e.unite_id IS NULL');
}
```

Important : ce filtre s'applique **après** `scopeUniteId` ; un chef scopé sur son unité ne peut pas lister les écritures sans unité (sa scope force `unite_id = X`, donc `IS NULL` retourne vide — comportement attendu).

- [ ] **Step 3 : Vérifier le typage TypeScript compile**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: pas d'erreur sur `ecritures.ts`.

- [ ] **Step 4 : Commit**

```bash
git add web/src/lib/services/ecritures.ts
git commit -m "feat(ecritures): filtre sans_unite pour audit couverture"
```

---

## Task 2 — Tab « Sans unité » sur `/ecritures`

**Files:**
- Modify: `web/src/app/(app)/ecritures/page.tsx`

- [ ] **Step 1 : Lire le param URL**

Dans `web/src/app/(app)/ecritures/page.tsx`, repérer le block `const filters = { … }` (ligne ~20-31) et ajouter :

```ts
const filters = {
  type: params.type || undefined,
  unite_id: params.unite_id || undefined,
  category_id: params.category_id || undefined,
  carte_id: params.carte_id || undefined,
  month: params.month || undefined,
  status: params.status || undefined,
  search: params.search || undefined,
  incomplete: params.incomplete === '1',
  from_bank: params.from_bank === '1',
  sans_unite: params.sans_unite === '1', // NEW
  limit: 200,
};
```

- [ ] **Step 2 : Étendre le helper `presetQS`**

Repérer la fonction `presetQS` (ligne ~63-68) et étendre :

```ts
const presetQS = (preset: 'all' | 'incomplete' | 'from_bank' | 'sans_unite') => {
  const sp = new URLSearchParams();
  if (preset === 'incomplete') sp.set('incomplete', '1');
  if (preset === 'from_bank') sp.set('from_bank', '1');
  if (preset === 'sans_unite') sp.set('sans_unite', '1');
  return sp.toString() ? `?${sp.toString()}` : '';
};
```

- [ ] **Step 3 : Ajouter le tab dans la barre**

Repérer le block `<div className="mb-4 flex flex-wrap gap-6 border-b">` (ligne ~80-90), ajouter un quatrième `<TabLink>` après « Issues de la banque » :

```tsx
<TabLink href={`/ecritures${presetQS('all')}`} active={!filters.incomplete && !filters.from_bank && !filters.sans_unite}>
  Toutes
</TabLink>
<TabLink href={`/ecritures${presetQS('incomplete')}`} active={!!filters.incomplete}>
  À compléter
</TabLink>
<TabLink href={`/ecritures${presetQS('from_bank')}`} active={!!filters.from_bank}>
  Issues de la banque
</TabLink>
<TabLink href={`/ecritures${presetQS('sans_unite')}`} active={!!filters.sans_unite}>
  Sans unité
</TabLink>
```

Note : le tab « Toutes » devient actif uniquement quand aucun preset n'est posé.

- [ ] **Step 4 : Vérification manuelle**

Lance le dev server (s'il ne tourne pas) :

```bash
cd web && pnpm dev
```

Ouvre `http://localhost:3000/ecritures?sans_unite=1`. Vérifie :
- Le tab « Sans unité » est actif (souligné).
- La liste affichée ne contient que des écritures dont la colonne « Unité » est vide.
- Cliquer sur « Toutes » ramène à la liste complète.

- [ ] **Step 5 : Commit**

```bash
git add web/src/app/(app)/ecritures/page.tsx
git commit -m "feat(ecritures): tab \"Sans unité\" pour audit couverture"
```

---

## Task 3 — Compteurs « Sans unité » dans `getOverview`

**Files:**
- Modify: `web/src/lib/services/overview.ts:38-51` (interface `OverviewData`) et `web/src/lib/services/overview.ts:53-139` (fonction `getOverview`)

- [ ] **Step 1 : Étendre l'interface `OverviewData`**

Dans `web/src/lib/services/overview.ts`, modifier le bloc `alertes` du type :

```ts
export interface OverviewData {
  // …champs existants…
  alertes: {
    depensesSansJustificatif: number;
    nonSyncComptaweb: number;
    ecrituresSansUnite: number;       // NEW
    remboursementsSansUnite: number;  // NEW
    caisseSansUnite: number;          // NEW
  };
  // …
}
```

- [ ] **Step 2 : Ajouter les 3 SELECT COUNT dans `getOverview`**

Juste avant le `return { … }` final de `getOverview` (vers la ligne 122), ajouter :

```ts
// Audit couverture unite_id : compte les opérations qui n'ont pas
// d'unité rattachée (tous statuts confondus, hors archived/refuse).
// Pré-requis pour piloter des budgets par unité.
const sansUniteEcr = await db.prepare(
  "SELECT COUNT(*) as count FROM ecritures WHERE group_id = ? AND unite_id IS NULL",
).get<{ count: number }>(groupId);

const sansUniteRbt = await db.prepare(
  "SELECT COUNT(*) as count FROM remboursements WHERE group_id = ? AND unite_id IS NULL AND status != 'refuse'",
).get<{ count: number }>(groupId);

const sansUniteCaisse = await db.prepare(
  "SELECT COUNT(*) as count FROM mouvements_caisse WHERE group_id = ? AND unite_id IS NULL AND archived_at IS NULL",
).get<{ count: number }>(groupId);
```

Note : pas de filtre exercice — l'audit est global pour comprendre la dette historique. Si on filtrait par exercice, on raterait la queue d'écritures anciennes non réimputées.

- [ ] **Step 3 : Brancher les compteurs dans le `return`**

Modifier le `return` pour inclure les nouveaux champs :

```ts
return {
  // …champs existants…
  alertes: {
    depensesSansJustificatif: sansJustif?.count ?? 0,
    nonSyncComptaweb: nonSync?.count ?? 0,
    ecrituresSansUnite: sansUniteEcr?.count ?? 0,
    remboursementsSansUnite: sansUniteRbt?.count ?? 0,
    caisseSansUnite: sansUniteCaisse?.count ?? 0,
  },
  // …
};
```

- [ ] **Step 4 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur (les call sites de `data.alertes.depensesSansJustificatif` continuent de fonctionner ; les nouveaux champs ne sont pas encore consommés).

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/services/overview.ts
git commit -m "feat(overview): compteurs \"sans unite_id\" pour ecritures/remb/caisse"
```

---

## Task 4 — Stat card « Sans unité » sur `/synthese`

**Files:**
- Modify: `web/src/app/(app)/synthese/page.tsx`

- [ ] **Step 1 : Importer l'icône**

En haut du fichier, dans l'import lucide-react, ajouter `Tag` (ou `Layers` — au choix ; on va prendre `Layers`) :

```ts
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  FileQuestion,
  Layers,         // NEW
  Scale,
  Upload,
} from 'lucide-react';
```

- [ ] **Step 2 : Ajouter la stat card dans le bloc d'alertes**

Repérer le `<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">` qui contient « Remb. en attente / Sans justificatif / Non saisies Comptaweb » (lignes ~103-122).

Le passer en `sm:grid-cols-2 lg:grid-cols-4` et ajouter une 4e card :

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
  <StatCard
    label="Remb. en attente"
    icon={Clock}
    value={data.remboursementsEnAttente.count}
    sublabel={data.remboursementsEnAttente.totalFormatted}
  />
  <StatCard
    label="Sans justificatif"
    icon={FileQuestion}
    value={data.alertes.depensesSansJustificatif}
    sublabel="dépenses"
  />
  <StatCard
    label="Non saisies Comptaweb"
    icon={Upload}
    value={data.alertes.nonSyncComptaweb}
    sublabel="écritures validées"
  />
  <Link href="/ecritures?sans_unite=1" className="block">
    <StatCard
      label="Sans unité"
      icon={Layers}
      value={data.alertes.ecrituresSansUnite}
      sublabel={
        data.alertes.remboursementsSansUnite + data.alertes.caisseSansUnite > 0
          ? `+ ${data.alertes.remboursementsSansUnite} remb, ${data.alertes.caisseSansUnite} caisse`
          : 'écritures'
      }
      className="hover:border-foreground/30 transition-colors cursor-pointer"
    />
  </Link>
</div>
```

Le wrapping `<Link>` cliquable est appliqué uniquement sur cette card (cohérent avec « cliquable = drill-down vers la liste »). Les autres cards restent statiques pour ne pas changer l'UX existante.

- [ ] **Step 3 : Vérification manuelle**

Recharge `http://localhost:3000/synthese`. Vérifie :
- 4 cartes alignées (1 sur mobile, 2 sur tablette, 4 sur desktop).
- La carte « Sans unité » affiche le bon nombre d'écritures.
- Le sublabel affiche `+ X remb, Y caisse` si non nuls, sinon « écritures ».
- Cliquer sur la carte ouvre `/ecritures?sans_unite=1`.

- [ ] **Step 4 : Commit**

```bash
git add web/src/app/(app)/synthese/page.tsx
git commit -m "feat(synthese): stat card \"Sans unité\" + lien audit"
```

---

## Task 5 — Composant `UniteCard`

**Files:**
- Create: `web/src/components/synthese/unite-card.tsx`

- [ ] **Step 1 : Créer le composant**

Crée `web/src/components/synthese/unite-card.tsx` :

```tsx
import Link from 'next/link';
import { FileQuestion, Upload } from 'lucide-react';
import { Amount } from '@/components/shared/amount';
import { cn } from '@/lib/utils';

// Carte par unité affichée sur /synthese. Liseré à la couleur charte
// SGDF, totaux dépenses/recettes/solde, badges d'alertes optionnels,
// cliquable vers /synthese/unite/[id] en préservant l'exercice filtré.

export interface UniteCardData {
  id: string;
  code: string;
  name: string;
  couleur: string | null;
  depenses: number;
  recettes: number;
  solde: number;
}

interface Props {
  unite: UniteCardData;
  exerciceParam: string;
  alertes?: { sansJustif?: number; nonSync?: number };
}

export function UniteCard({ unite, exerciceParam, alertes }: Props) {
  const couleur = unite.couleur ?? '#C9C9C9';
  const href = `/synthese/unite/${unite.id}?exercice=${exerciceParam}`;
  return (
    <Link
      href={href}
      className={cn(
        'block rounded-lg border bg-card p-4 transition-shadow',
        'hover:shadow-md hover:border-foreground/20',
      )}
      style={{
        boxShadow: `inset 3px 0 0 0 ${couleur}`,
        backgroundColor: `${couleur}0A`,
      }}
    >
      <div className="text-sm font-semibold mb-3">
        {unite.code} <span className="text-muted-foreground font-normal">— {unite.name}</span>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Dépenses</dt>
          <dd className="tabular-nums"><Amount cents={unite.depenses} tone="negative" /></dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Recettes</dt>
          <dd className="tabular-nums"><Amount cents={unite.recettes} tone="positive" /></dd>
        </div>
        <div className="flex justify-between border-t pt-1.5 font-medium">
          <dt>Solde</dt>
          <dd className="tabular-nums"><Amount cents={unite.solde} tone="signed" /></dd>
        </div>
      </dl>
      {alertes && (alertes.sansJustif || alertes.nonSync) ? (
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
          {alertes.sansJustif ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 text-amber-800 text-[11px] px-1.5 py-0.5">
              <FileQuestion size={11} strokeWidth={1.75} />
              {alertes.sansJustif} sans justif
            </span>
          ) : null}
          {alertes.nonSync ? (
            <span className="inline-flex items-center gap-1 rounded bg-blue-50 text-blue-800 text-[11px] px-1.5 py-0.5">
              <Upload size={11} strokeWidth={1.75} />
              {alertes.nonSync} non sync
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
```

- [ ] **Step 2 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add web/src/components/synthese/unite-card.tsx
git commit -m "feat(synthese): composant UniteCard"
```

---

## Task 6 — Composant `UnitesGrid`

**Files:**
- Create: `web/src/components/synthese/unites-grid.tsx`

- [ ] **Step 1 : Créer le composant**

Crée `web/src/components/synthese/unites-grid.tsx` :

```tsx
import Link from 'next/link';
import { UniteCard, type UniteCardData } from './unite-card';

interface Props {
  unites: UniteCardData[];
  exerciceParam: string;
}

export function UnitesGrid({ unites, exerciceParam }: Props) {
  if (unites.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune unité importée.{' '}
        <Link href="/import" className="text-brand hover:underline underline-offset-2">
          Synchronise les référentiels Comptaweb
        </Link>
        {' '}pour les voir apparaître.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {unites.map((u) => (
        <UniteCard key={u.id} unite={u} exerciceParam={exerciceParam} />
      ))}
    </div>
  );
}
```

Note : les alertes par unité (sans justif / non sync **scopées par unité**) ne sont pas calculées par `getOverview` global aujourd'hui. On les ajoutera en Task 7 quand on créera `getUniteOverview` ; pour la grille de la synthèse, on reste sans badges d'alerte par carte (elles vivent au global au-dessus, dans la stat card de Task 4). Le prop `alertes` du composant reste donc inutilisé ici, mais sera utilisé sur la page détail.

- [ ] **Step 2 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add web/src/components/synthese/unites-grid.tsx
git commit -m "feat(synthese): composant UnitesGrid"
```

---

## Task 7 — Remplacer la table « Par unité » par `<UnitesGrid>`

**Files:**
- Modify: `web/src/app/(app)/synthese/page.tsx`

- [ ] **Step 1 : Importer le composant**

Ajouter en haut du fichier :

```ts
import { UnitesGrid } from '@/components/synthese/unites-grid';
```

- [ ] **Step 2 : Construire les data et rendre la grille**

Repérer la `<Section title="Par unité" …>` (lignes ~124-168) et la remplacer entièrement par :

```tsx
<Section
  title="Par unité"
  subtitle="Cliquez sur une unité pour voir le détail des dépenses et de la répartition par catégorie."
  className="mb-8"
>
  <UnitesGrid
    unites={data.parUnite.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      couleur: u.couleur,
      depenses: u.depenses,
      recettes: u.recettes,
      solde: u.solde,
    }))}
    exerciceParam={exerciceParam}
  />
</Section>
```

- [ ] **Step 3 : Étendre `getOverview` pour inclure `id` dans `parUnite`**

`UnitesGrid` a besoin de `unite.id` pour construire le lien. Aujourd'hui `getOverview` retourne `code, name, couleur, depenses, recettes, solde`. Ouvre `web/src/lib/services/overview.ts`.

Modifier la query SQL `parUnite` (ligne ~78-85) pour récupérer aussi `u.id` :

```ts
const parUnite = await db.prepare(`
  SELECT u.id, u.code, u.name, u.couleur,
    COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
    COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes
  FROM unites u LEFT JOIN ecritures e ON e.unite_id = u.id AND e.group_id = ?${dateClause}
  WHERE u.group_id = ?
  GROUP BY u.id ORDER BY u.code
`).all<{ id: string; code: string; name: string; couleur: string | null; depenses: number; recettes: number }>(groupId, ...dateValues, groupId);
```

Modifier le type `OverviewData.parUnite` correspondant :

```ts
parUnite: { id: string; code: string; name: string; couleur: string | null; depenses: number; recettes: number; solde: number }[];
```

- [ ] **Step 4 : Supprimer les imports devenus inutiles**

Dans `web/src/app/(app)/synthese/page.tsx`, retirer les imports `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` **uniquement si** la deuxième table « Par catégorie » ne les utilise plus.

Vérification rapide : la table « Par catégorie » plus bas (lignes ~175-216) **continue** d'utiliser ces composants — donc **on ne touche pas aux imports**. Ne pas supprimer.

- [ ] **Step 5 : Vérification manuelle**

Recharge `http://localhost:3000/synthese`. Vérifie :
- À la place de la table, une grille de cartes (1/2/3 colonnes selon largeur).
- Chaque carte a son liseré coloré et ses 3 chiffres.
- Au hover, légère ombre + bordure.
- Clic ouvre `/synthese/unite/<id>?exercice=...` (404 attendu en l'état — la page n'existe pas encore, on la fait juste après).

- [ ] **Step 6 : Commit**

```bash
git add web/src/app/(app)/synthese/page.tsx web/src/lib/services/overview.ts
git commit -m "feat(synthese): remplace table par unite par grille de cartes"
```

---

## Task 8 — Service `getUniteOverview`

**Files:**
- Modify: `web/src/lib/services/overview.ts`
- Modify: `web/src/lib/queries/overview.ts`

- [ ] **Step 1 : Définir le type `UniteOverviewData`**

Dans `web/src/lib/services/overview.ts`, après l'interface `OverviewData`, ajouter :

```ts
export interface EcritureLite {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  category_name: string | null;
  numero_piece: string | null;
}

export interface UniteOverviewData {
  unite: {
    id: string;
    code: string;
    name: string;
    couleur: string | null;
    branche: string | null;
  };
  exerciceFiltre: string | null;
  totalDepenses: number;
  totalRecettes: number;
  solde: number;
  parCategorie: CategorieRow[];
  alertes: { depensesSansJustificatif: number; nonSyncComptaweb: number };
  ecrituresRecentes: EcritureLite[];
  totalEcritures: number;
}
```

- [ ] **Step 2 : Implémenter `getUniteOverview`**

Toujours dans le même fichier, après la fonction `getOverview`, ajouter :

```ts
export interface UniteOverviewArgs {
  uniteId: string;
}

// Renvoie null si l'unité n'appartient pas au group (anti-énumération
// inter-groupes — la page render un 404 indistinguable de "n'existe pas").
export async function getUniteOverview(
  { groupId }: OverviewContext,
  args: UniteOverviewArgs,
  filters: OverviewFilters = {},
): Promise<UniteOverviewData | null> {
  const db = getDb();

  const unite = await db.prepare(
    'SELECT id, code, name, couleur, branche FROM unites WHERE id = ? AND group_id = ?',
  ).get<{ id: string; code: string; name: string; couleur: string | null; branche: string | null }>(
    args.uniteId,
    groupId,
  );
  if (!unite) return null;

  let dateClause = '';
  const dateValues: unknown[] = [];
  if (filters.exercice) {
    const { start, end } = exerciceBounds(filters.exercice);
    dateClause = ' AND e.date_ecriture >= ? AND e.date_ecriture <= ?';
    dateValues.push(start, end);
  }

  const totaux = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'depense' THEN amount_cents ELSE 0 END), 0) as dep,
       COALESCE(SUM(CASE WHEN type = 'recette' THEN amount_cents ELSE 0 END), 0) as rec
     FROM ecritures e
     WHERE e.group_id = ? AND e.unite_id = ?${dateClause}`,
  ).get<{ dep: number; rec: number }>(groupId, args.uniteId, ...dateValues);

  const parCategorie = await db.prepare(`
    SELECT
      c.id as category_id,
      COALESCE(c.name, '(non catégorisé)') as category_name,
      c.comptaweb_id,
      COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
      COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes
    FROM ecritures e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.group_id = ? AND e.unite_id = ?${dateClause}
    GROUP BY c.id
    ORDER BY (depenses + recettes) DESC
  `).all<CategorieRow>(groupId, args.uniteId, ...dateValues);

  const sansJustif = await db.prepare(`
    SELECT COUNT(*) as count FROM ecritures e
    WHERE e.group_id = ? AND e.unite_id = ? AND e.type = 'depense' AND e.justif_attendu = 1
    AND NOT EXISTS (SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id)
  `).get<{ count: number }>(groupId, args.uniteId);

  const nonSync = await db.prepare(
    "SELECT COUNT(*) as count FROM ecritures WHERE group_id = ? AND unite_id = ? AND comptaweb_synced = 0 AND status != 'brouillon'",
  ).get<{ count: number }>(groupId, args.uniteId);

  const ecrituresRecentes = await db.prepare(`
    SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type,
           e.numero_piece, c.name as category_name
    FROM ecritures e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.group_id = ? AND e.unite_id = ?${dateClause}
    ORDER BY e.date_ecriture DESC, e.id DESC
    LIMIT 50
  `).all<EcritureLite>(groupId, args.uniteId, ...dateValues);

  const totalEcrRow = await db.prepare(
    `SELECT COUNT(*) as count FROM ecritures e WHERE e.group_id = ? AND e.unite_id = ?${dateClause}`,
  ).get<{ count: number }>(groupId, args.uniteId, ...dateValues);

  const dep = totaux?.dep ?? 0;
  const rec = totaux?.rec ?? 0;

  return {
    unite,
    exerciceFiltre: filters.exercice ?? null,
    totalDepenses: dep,
    totalRecettes: rec,
    solde: rec - dep,
    parCategorie,
    alertes: {
      depensesSansJustificatif: sansJustif?.count ?? 0,
      nonSyncComptaweb: nonSync?.count ?? 0,
    },
    ecrituresRecentes,
    totalEcritures: totalEcrRow?.count ?? 0,
  };
}
```

- [ ] **Step 3 : Re-exporter dans `lib/queries/overview.ts`**

Ouvre `web/src/lib/queries/overview.ts` et étendre le module :

```ts
import { getCurrentContext } from '../context';
import {
  getOverview as getOverviewService,
  getUniteOverview as getUniteOverviewService,
  type OverviewData,
  type OverviewFilters,
  type UniteOverviewData,
} from '../services/overview';

export type { OverviewData, OverviewFilters, UniteOverviewData };

export async function getOverview(filters: OverviewFilters = {}): Promise<OverviewData> {
  const { groupId } = await getCurrentContext();
  return getOverviewService({ groupId }, filters);
}

export async function getUniteOverview(
  uniteId: string,
  filters: OverviewFilters = {},
): Promise<UniteOverviewData | null> {
  const { groupId } = await getCurrentContext();
  return getUniteOverviewService({ groupId }, { uniteId }, filters);
}
```

- [ ] **Step 4 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/services/overview.ts web/src/lib/queries/overview.ts
git commit -m "feat(overview): service getUniteOverview pour page détail unité"
```

---

## Task 9 — Page détail `/synthese/unite/[id]/page.tsx`

**Files:**
- Create: `web/src/app/(app)/synthese/unite/[id]/page.tsx`

- [ ] **Step 1 : Créer la page**

Crée le dossier puis le fichier :

```bash
mkdir -p web/src/app/\(app\)/synthese/unite/\[id\]
```

Crée `web/src/app/(app)/synthese/unite/[id]/page.tsx` :

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowDownCircle, ArrowUpCircle, FileQuestion, Scale, Upload } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/shared/amount';
import { Section } from '@/components/shared/section';
import { StatCard } from '@/components/shared/stat-card';
import { TabLink } from '@/components/shared/tab-link';
import { getUniteOverview } from '@/lib/queries/overview';
import { currentExercice } from '@/lib/services/overview';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';

interface SearchParams { exercice?: string }

function exerciceOptions(): { value: string; label: string }[] {
  const cur = currentExercice();
  const curStart = parseInt(cur.split('-')[0], 10);
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const y = curStart - i;
    opts.push({ value: `${y}-${y + 1}`, label: `Sept ${y} → Août ${y + 1}` });
  }
  return opts;
}

export default async function UniteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  requireNotParent(ctx.role);
  const { id } = await params;
  const sp = await searchParams;
  const cur = currentExercice();
  const exerciceParam = sp.exercice ?? cur;
  const exerciceFilter = exerciceParam === 'tous' ? null : exerciceParam;

  const data = await getUniteOverview(id, { exercice: exerciceFilter });
  if (!data) notFound();

  const couleur = data.unite.couleur ?? '#C9C9C9';
  const options = exerciceOptions();

  return (
    <div>
      <Link
        href={`/synthese?exercice=${exerciceParam}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft size={14} /> Synthèse
      </Link>

      <div
        className="pl-3 mb-6"
        style={{ boxShadow: `inset 3px 0 0 0 ${couleur}` }}
      >
        <PageHeader
          title={`${data.unite.code} — ${data.unite.name}`}
          subtitle="Détail des dépenses, recettes et alertes pour cette unité."
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-6 border-b">
        {options.map((o) => (
          <TabLink
            key={o.value}
            href={`/synthese/unite/${id}?exercice=${o.value}`}
            active={exerciceParam === o.value}
          >
            {o.label}
          </TabLink>
        ))}
        <TabLink href={`/synthese/unite/${id}?exercice=tous`} active={exerciceParam === 'tous'}>
          Tous
        </TabLink>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Dépenses"
          icon={ArrowDownCircle}
          value={<Amount cents={data.totalDepenses} tone="negative" />}
        />
        <StatCard
          label="Recettes"
          icon={ArrowUpCircle}
          value={<Amount cents={data.totalRecettes} tone="positive" />}
        />
        <StatCard
          label="Solde"
          icon={Scale}
          value={<Amount cents={data.solde} tone="signed" />}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Link href={`/ecritures?unite_id=${id}&incomplete=1`} className="block">
          <StatCard
            label="Sans justificatif"
            icon={FileQuestion}
            value={data.alertes.depensesSansJustificatif}
            sublabel="dépenses"
            className="hover:border-foreground/30 transition-colors cursor-pointer"
          />
        </Link>
        <Link href={`/ecritures?unite_id=${id}&status=valide`} className="block">
          <StatCard
            label="Non saisies Comptaweb"
            icon={Upload}
            value={data.alertes.nonSyncComptaweb}
            sublabel="écritures validées"
            className="hover:border-foreground/30 transition-colors cursor-pointer"
          />
        </Link>
      </div>

      <Section
        title="Par catégorie"
        subtitle="Répartition des dépenses et recettes de l'unité par nature comptable SGDF."
        className="mb-8"
        bodyClassName="px-0 pb-0"
      >
        {data.parCategorie.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            Aucune écriture sur la période sélectionnée.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Catégorie</TableHead>
                <TableHead className="text-right">Dépenses</TableHead>
                <TableHead className="text-right">Recettes</TableHead>
                <TableHead className="text-right">CW#</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.parCategorie.map((c) => (
                <TableRow key={c.category_id ?? 'none'}>
                  <TableCell className="font-medium flex items-center gap-1.5">
                    {c.comptaweb_id === null && c.category_id !== null && (
                      <span
                        className="size-1.5 rounded-full bg-amber-500 shrink-0"
                        title="Pas de mapping Comptaweb — non synchronisable"
                      />
                    )}
                    {c.category_id === null && (
                      <span
                        className="size-1.5 rounded-full bg-rose-500 shrink-0"
                        title="Écritures sans catégorie — à compléter"
                      />
                    )}
                    {c.category_name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.depenses > 0 ? <Amount cents={c.depenses} tone="negative" /> : <span className="text-fg-subtle">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.recettes > 0 ? <Amount cents={c.recettes} tone="positive" /> : <span className="text-fg-subtle">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[11px] text-fg-subtle">
                    {c.comptaweb_id ?? <span className="text-amber-700">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title={`Écritures récentes (${data.ecrituresRecentes.length} sur ${data.totalEcritures})`}
        subtitle="Les 50 dernières écritures rattachées à cette unité, dans la période sélectionnée."
        className="mb-8"
        bodyClassName="px-0 pb-0"
      >
        {data.ecrituresRecentes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            Aucune écriture rattachée à cette unité sur la période.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.ecrituresRecentes.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="tabular-nums whitespace-nowrap">{e.date_ecriture}</TableCell>
                    <TableCell>
                      <Link href={`/ecritures?detail=${e.id}`} className="hover:underline underline-offset-2">
                        {e.description}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.category_name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Amount cents={e.amount_cents} tone={e.type === 'depense' ? 'negative' : 'positive'} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.totalEcritures > data.ecrituresRecentes.length && (
              <div className="px-5 py-3 border-t">
                <Link
                  href={`/ecritures?unite_id=${id}`}
                  className="text-sm text-brand hover:underline underline-offset-2"
                >
                  Voir toutes les écritures de l'unité ({data.totalEcritures}) →
                </Link>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
```

- [ ] **Step 2 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Vérification manuelle**

Recharge la synthèse, clique sur une carte d'unité. Vérifie :
- Page s'ouvre avec breadcrumb « Synthèse ».
- Header avec liseré couleur SGDF de la branche.
- 3 stat cards Dépenses/Recettes/Solde avec les bonnes valeurs.
- 2 stat cards alertes cliquables menant aux bons filtres `/ecritures`.
- Table « Par catégorie » filtrée sur l'unité.
- Liste « Écritures récentes » (max 50).
- Lien « Voir toutes les écritures (N) » si > 50.
- Sélecteur d'exercice change l'URL et recalcule.

- [ ] **Step 4 : Commit**

```bash
git add web/src/app/\(app\)/synthese/unite/\[id\]/page.tsx
git commit -m "feat(synthese): page detail par unite"
```

---

## Task 10 — `not-found.tsx` pour la route détail

**Files:**
- Create: `web/src/app/(app)/synthese/unite/[id]/not-found.tsx`

- [ ] **Step 1 : Créer le composant**

Crée `web/src/app/(app)/synthese/unite/[id]/not-found.tsx` :

```tsx
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function UniteNotFound() {
  return (
    <div className="max-w-md">
      <Link
        href="/synthese"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft size={14} /> Synthèse
      </Link>
      <h1 className="text-xl font-semibold mb-2">Unité introuvable</h1>
      <p className="text-sm text-muted-foreground">
        Cette unité n'existe pas ou n'appartient pas à ton groupe. Reviens à la synthèse pour
        choisir une unité disponible.
      </p>
    </div>
  );
}
```

- [ ] **Step 2 : Vérification manuelle (anti-énumération)**

Ouvre `http://localhost:3000/synthese/unite/un-id-bidon-qui-n-existe-pas?exercice=2025-2026`. Vérifie :
- Page « Unité introuvable » s'affiche.
- Status HTTP 404 (DevTools Network).

Si tu peux récupérer un id d'unité d'un autre groupe (en BDD prod ou via SQL), tester aussi : la même page 404 doit s'afficher (pas de fuite d'info).

- [ ] **Step 3 : Commit**

```bash
git add web/src/app/\(app\)/synthese/unite/\[id\]/not-found.tsx
git commit -m "feat(synthese): not-found page pour unite introuvable"
```

---

## Task 11 — Vérification finale et build

- [ ] **Step 1 : Build production**

Run:

```bash
cd web && pnpm build
```

Expected: build OK, aucune erreur TS, aucune route en `force-dynamic` cassée.

Si la page `/synthese/unite/[id]` plante au build avec « Dynamic server usage », ajouter au top du fichier `page.tsx` :

```ts
export const dynamic = 'force-dynamic';
```

(cf. `web/AGENTS.md` section « `force-dynamic` quand la page utilise cookies / headers / auth »).

- [ ] **Step 2 : Smoke test fonctionnel**

Avec le dev server qui tourne :

1. `/synthese` → grille de cartes par unité visible, stat cards en haut + 4 stat cards d'alerte (dont « Sans unité ») au milieu.
2. Clic sur stat card « Sans unité » → `/ecritures?sans_unite=1`, tab « Sans unité » actif, liste filtrée.
3. Clic sur une carte d'unité → page détail correspondante.
4. Sur le détail, changer d'exercice → URL et chiffres recalculés.
5. Sur le détail, clic sur « Voir toutes les écritures » → liste filtrée par unité.
6. Sur le détail, clic sur stat card « Sans justificatif » → liste filtrée par unité **et** preset incomplete.
7. Clic « Synthèse » dans le breadcrumb → retour à `/synthese` avec exercice préservé.
8. URL `/synthese/unite/<id-bidon>` → page 404 « Unité introuvable ».

- [ ] **Step 3 : Pas de push automatique**

Conformément à la convention projet (cf. `web/AGENTS.md` et mémoire utilisateur), **ne pas pousser** sur la remote. Demander explicitement avant tout `git push`.

---

## Self-review — couverture spec

- ✅ Section « Par unité » de `/synthese` remplacée par grille cliquable (Tasks 5, 6, 7)
- ✅ Page détail `/synthese/unite/[id]` avec header, KPIs, alertes, table catégories, écritures récentes (Tasks 8, 9)
- ✅ `not-found.tsx` pour 404 anti-énumération (Task 10)
- ✅ Pas d'évolution mensuelle (volontairement absente)
- ✅ Pré-requis couverture `unite_id` : compteurs sur synthèse + filtre `/ecritures?sans_unite=1` + tab dédié (Tasks 1, 2, 3, 4)
- ✅ Pas de modif de schéma BDD
- ✅ Pas de tests unitaires (cohérent avec pattern projet sur services BDD-coupled)
- ✅ Vérification anti-énumération (Task 10 step 2)
