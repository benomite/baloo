# Vue camp : onglets Dépenses/Recettes + liste paiements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réorganiser `/camps/[id]` en deux onglets (Dépenses / Recettes) et afficher, côté Recettes, la liste détaillée des paiements reçus (écritures de recette du camp).

**Architecture:** Une fonction de requête `selectCampRecettes` (testable, injection de `db`) alimente un nouveau champ `recettes` de `CampDashboard`. La page `[id]/page.tsx` (server component) répartit ses sections existantes entre deux panneaux et les passe à un composant client `CampTabs` qui gère l'onglet actif.

**Tech Stack:** Next.js 16 (App Router, server + client components), libsql/Turso, vitest. Spec : `doc/specs/2026-06-27-camps-recettes-onglets-design.md`.

## Global Constraints

- **Lecture seule** : aucune écriture, aucune nouvelle table. On lit `ecritures` / `categories` existantes.
- **Appartenance camp** : une écriture appartient au camp si `activite_id = camp.activite_id AND unite_id = camp.unite_id` (« camp = activité × unité »).
- **Exclusions** : toujours exclure les catégories de transfert via `CATEGORIES_HORS_RESULTAT` (`(e.category_id IS NULL OR e.category_id NOT IN (...))`), comme les autres requêtes de `getCampDashboard`.
- **Onglet par défaut** : Dépenses (continuité avec l'usage actuel).
- **État onglet = client local**, pas de navigation `?tab=` (cohérent avec le pattern UI du projet).
- **Tests BDD** : in-memory (`createClient({ url: 'file::memory:' })`), jamais `data/baloo.db`.
- **`'use client'`** : un fichier marqué `'use client'` n'exporte que du composant React — pas de helper serveur (cf. `web/AGENTS.md`).
- **Montants** en centimes, formatés via `<Amount cents={...} />`.
- Commandes depuis `web/` ; si `pnpm` échoue avec « packages field missing », utiliser `./node_modules/.bin/{vitest,tsc,eslint}`.

---

## File Structure

- **Modify** `web/src/lib/services/camps.ts` : ajouter `selectCampRecettes(...)` (exportée, testable) + champ `recettes` à `CampDashboard` + appel dans `getCampDashboard`.
- **Create** `web/src/lib/services/__tests__/camps-recettes.test.ts` : test in-memory de `selectCampRecettes`.
- **Create** `web/src/components/camps/camp-tabs.tsx` : composant client, 2 onglets.
- **Modify** `web/src/app/(app)/camps/[id]/page.tsx` : répartir les sections en 2 panneaux + nouvelle section « Paiements reçus ».

---

## Task 1 : Requête recettes + champ `recettes` du dashboard

**Files:**
- Modify: `web/src/lib/services/camps.ts`
- Test: `web/src/lib/services/__tests__/camps-recettes.test.ts`

**Interfaces:**
- Consumes: `DbWrapper` (`web/src/lib/db.ts`), `EcritureCampRow` (déjà dans `camps.ts`), `CATEGORIES_HORS_RESULTAT` (importé dans `camps.ts`).
- Produces:
  - `selectCampRecettes(db: DbWrapper, groupId: string, activiteId: string, uniteId: string): Promise<EcritureCampRow[]>` — écritures `type='recette'` du camp, hors catégories de transfert, triées par date décroissante.
  - `CampDashboard.recettes: EcritureCampRow[]` (nouveau champ).

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/services/__tests__/camps-recettes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';
import { selectCampRecettes } from '../camps';

// Schéma minimal : ecritures (colonnes touchées) + categories (jointe) +
// justificatifs/remboursements vides (les EXISTS de EcritureCampRow → 0).
const SETUP_SQL = `
  CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE justificatifs (entity_type TEXT, entity_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, activite_id TEXT, unite_id TEXT,
    date_ecriture TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL, category_id TEXT, justif_attendu INTEGER NOT NULL DEFAULT 0
  );
`;

async function setupDb() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  const db = wrapClient(client);
  await db.prepare("INSERT INTO categories (id, name) VALUES ('cat-part', 'Participations'), ('cat-depot-especes', 'Transfert')").run();
  return db;
}

const ins = (id: string, over: Partial<{ act: string; uni: string; type: string; cat: string | null; amt: number; date: string }> = {}) =>
  ({ id, act: over.act ?? 'ACT1', uni: over.uni ?? 'UNI1', type: over.type ?? 'recette', cat: over.cat === undefined ? 'cat-part' : over.cat, amt: over.amt ?? 5000, date: over.date ?? '2026-07-10' });

describe('selectCampRecettes', () => {
  let db: Awaited<ReturnType<typeof setupDb>>;
  beforeEach(async () => {
    db = await setupDb();
    const rows = [
      ins('R1'),                                  // recette du camp → incluse
      ins('R2', { date: '2026-07-15' }),          // recette du camp (plus récente) → incluse, en tête
      ins('D1', { type: 'depense' }),             // dépense → exclue
      ins('R3', { uni: 'AUTRE' }),                // autre unité → exclue
      ins('R4', { act: 'AUTRE' }),                // autre activité → exclue
      ins('R5', { cat: 'cat-depot-especes' }),    // catégorie de transfert → exclue
      ins('RG', { uni: 'UNI1', act: 'ACT1' }),    // recette du camp, groupe différent → exclue (group_id)
    ];
    for (const r of rows) {
      const gid = r.id === 'RG' ? 'autre-groupe' : 'g1';
      await db.prepare(
        "INSERT INTO ecritures (id, group_id, activite_id, unite_id, date_ecriture, description, amount_cents, type, category_id) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(r.id, gid, r.act, r.uni, r.date, `desc ${r.id}`, r.amt, r.type, r.cat);
    }
  });

  it('ne retourne que les recettes du camp (activité × unité), hors transfert, triées par date desc', async () => {
    const res = await selectCampRecettes(db, 'g1', 'ACT1', 'UNI1');
    expect(res.map((e) => e.id)).toEqual(['R2', 'R1']);
    expect(res[0].type).toBe('recette');
    expect(res[0].category_name).toBe('Participations');
  });

  it('renvoie [] si aucune recette', async () => {
    expect(await selectCampRecettes(db, 'g1', 'ACT-VIDE', 'UNI1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/camps-recettes.test.ts`
Expected: FAIL — `selectCampRecettes` n'est pas exporté.

- [ ] **Step 3: Implement `selectCampRecettes` and wire it into the dashboard**

Dans `web/src/lib/services/camps.ts` :

(a) Ajouter le champ à l'interface `CampDashboard` (après `justifsManquants`) :

```ts
  recettes: EcritureCampRow[];
```

(b) Ajouter la fonction exportée (au-dessus de `getCampDashboard`). Elle réutilise la même forme que `ECR_SELECT` mais en standalone pour être testable avec un `db` injecté :

```ts
import type { DbWrapper } from '../db';

export async function selectCampRecettes(
  db: DbWrapper,
  groupId: string,
  activiteId: string,
  uniteId: string,
): Promise<EcritureCampRow[]> {
  const exclus = CATEGORIES_HORS_RESULTAT.map(() => '?').join(',');
  return db.prepare(
    `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type, e.justif_attendu,
            c.name AS category_name,
            EXISTS(SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id) AS has_justificatif,
            (SELECT r.id FROM remboursements r WHERE r.ecriture_id = e.id LIMIT 1) AS remboursement_id
     FROM ecritures e LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.group_id = ? AND e.activite_id = ? AND e.unite_id = ? AND e.type = 'recette'
       AND (e.category_id IS NULL OR e.category_id NOT IN (${exclus}))
     ORDER BY e.date_ecriture DESC, e.id DESC`,
  ).all<EcritureCampRow>(groupId, activiteId, uniteId, ...CATEGORIES_HORS_RESULTAT);
}
```

> Note implémenteur : `DbWrapper` est peut-être déjà importé dans `camps.ts` (vérifie l'en-tête). `CATEGORIES_HORS_RESULTAT` y est déjà importé (utilisé par `EXCLUS`).

(c) Dans `getCampDashboard`, après le bloc `justifsManquants`, appeler la fonction et l'ajouter au return :

```ts
  const recettes = await selectCampRecettes(db, ctx.groupId, camp.activite_id, camp.unite_id);
```

puis dans le `return { ... }` ajouter `recettes,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/camps-recettes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd web && ./node_modules/.bin/tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/services/camps.ts web/src/lib/services/__tests__/camps-recettes.test.ts
git commit -m "feat(camps): requête recettes du camp + champ dashboard"
```

---

## Task 2 : Onglets Dépenses/Recettes + section Paiements reçus

**Files:**
- Create: `web/src/components/camps/camp-tabs.tsx`
- Modify: `web/src/app/(app)/camps/[id]/page.tsx`

**Interfaces:**
- Consumes: `CampDashboard.recettes` (Task 1) ; `Section` (`@/components/shared/section`), `Amount`, `EmptyState`, déjà importés dans la page.
- Produces: `CampTabs({ depenses, recettes }: { depenses: React.ReactNode; recettes: React.ReactNode })`.

Tâche UI : pas de test automatisé (pas d'E2E dans le repo). Garde-fous = tsc + lint + vérification manuelle.

- [ ] **Step 1: Créer le composant onglets**

Create `web/src/components/camps/camp-tabs.tsx` :

```tsx
'use client';

import { useState } from 'react';

// Onglets Dépenses / Recettes de la vue camp. Les deux panneaux sont rendus
// côté serveur et passés en props ; on bascule l'affichage via `hidden` pour
// préserver l'état des éléments interactifs (ex. <details> du form avance).
export function CampTabs({
  depenses,
  recettes,
}: {
  depenses: React.ReactNode;
  recettes: React.ReactNode;
}) {
  const [tab, setTab] = useState<'depenses' | 'recettes'>('depenses');

  const tabClass = (active: boolean) =>
    `px-3 py-2 text-[13.5px] font-medium border-b-2 -mb-px transition-colors ${
      active
        ? 'border-brand text-fg'
        : 'border-transparent text-fg-muted hover:text-fg'
    }`;

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-border mb-6">
        <button role="tab" type="button" aria-selected={tab === 'depenses'} onClick={() => setTab('depenses')} className={tabClass(tab === 'depenses')}>
          Dépenses
        </button>
        <button role="tab" type="button" aria-selected={tab === 'recettes'} onClick={() => setTab('recettes')} className={tabClass(tab === 'recettes')}>
          Recettes
        </button>
      </div>
      <div className={tab === 'depenses' ? '' : 'hidden'}>{depenses}</div>
      <div className={tab === 'recettes' ? '' : 'hidden'}>{recettes}</div>
    </div>
  );
}
```

- [ ] **Step 2: Brancher les onglets dans la page**

Dans `web/src/app/(app)/camps/[id]/page.tsx` :

(a) Ajouter les imports en tête :

```ts
import { CampTabs } from '@/components/camps/camp-tabs';
```

(b) Ajouter `recettes` à la déstructuration du dashboard (ligne ~118) :

```ts
  const { camp, rows, ecrituresRecentes, depotsEnAttente, justifsManquants, sansUniteCount, recettes } =
    dashboard;
```

(c) Remplacer le bloc `<div className="space-y-6"> ... </div>` (qui contient aujourd'hui les Sections « Budget dépenses », « Recettes », « Avances de trésorerie », « Justificatifs manquants », « Dépenses récentes ») par un `<CampTabs>` à deux panneaux :
- **Panneau `depenses`** : les Sections « Budget dépenses », « Avances de trésorerie », « Justificatifs manquants », « Dépenses récentes » — **exactement le JSX actuel de ces sections**, déplacé tel quel.
- **Panneau `recettes`** : la Section « Recettes » existante (total encaissé/attendu + `Jauge`) déplacée ici, **suivie** d'une nouvelle Section « Paiements reçus ».

Structure cible :

```tsx
      <CampTabs
        depenses={
          <div className="space-y-6">
            {/* Section "Budget dépenses" — JSX actuel inchangé */}
            {/* Section "Avances de trésorerie" — JSX actuel inchangé */}
            {/* Section "Justificatifs manquants" (conditionnelle) — JSX actuel inchangé */}
            {/* Section "Dépenses récentes" — JSX actuel inchangé */}
          </div>
        }
        recettes={
          <div className="space-y-6">
            {/* Section "Recettes" — JSX actuel inchangé (total + Jauge) */}
            <Section title="Paiements reçus">
              {recettes.length === 0 ? (
                <EmptyState
                  title="Aucun paiement"
                  description="Aucune recette encaissée sur ce camp pour l'instant."
                  className="py-6"
                />
              ) : (
                <ul className="divide-y divide-border-soft rounded-lg border border-border-soft overflow-hidden">
                  {recettes.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                      <span className="tabular-nums text-fg-subtle shrink-0">{e.date_ecriture}</span>
                      <span className="min-w-0 flex-1 truncate text-fg">
                        {e.description}
                        {e.category_name && <span className="text-fg-subtle"> · {e.category_name}</span>}
                      </span>
                      <span className="tabular-nums shrink-0">
                        <Amount cents={e.amount_cents} tone="positive" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        }
      />
```

Garde le header (`PageHeader`), les alertes `error`/`sansUniteCount` AU-DESSUS de `<CampTabs>` (inchangés). Les fonctions helper (`PosteRow`, `AvanceRow`, `CreateAvanceForm`, `Jauge`, etc.) restent inchangées.

- [ ] **Step 3: Typecheck + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/app/\(app\)/camps/\[id\]/page.tsx src/components/camps/camp-tabs.tsx`
Expected: 0 erreur. Corriger un éventuel import inutilisé.

- [ ] **Step 4: Vérification manuelle**

Run: `cd web && pnpm dev` (ou `./node_modules/.bin/next dev`)
Ouvrir un camp existant `/camps/<id>` connecté en `tresorier` :
- Deux onglets « Dépenses » / « Recettes », défaut sur Dépenses.
- Onglet Dépenses : budget dépenses, avances, justifs manquants, dépenses récentes (comme avant).
- Onglet Recettes : bloc encaissé/attendu + barre, puis liste « Paiements reçus » (date · libellé · catégorie · montant), ou état vide.
- L'alerte `sansUniteCount` (si présente) et le header restent au-dessus des onglets.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/camps/camp-tabs.tsx web/src/app/\(app\)/camps/\[id\]/page.tsx
git commit -m "feat(camps): vue en onglets Dépenses/Recettes + liste des paiements reçus"
```

---

## Self-Review (auteur)

**Spec coverage :**
- 2 onglets Dépenses/Recettes, défaut Dépenses ✅ (Task 2).
- Onglet Dépenses = existant inchangé ✅ (Task 2, sections déplacées telles quelles).
- Onglet Recettes = total encaissé/prévu (existant) + liste détaillée des paiements ✅ (Task 2).
- Liste = écritures recette du camp (activité × unité), hors transfert, triées date desc ✅ (Task 1).
- `sansUniteCount` conservé ✅ (Task 2, au-dessus des onglets).
- Lecture seule, pas de table ✅. Tests in-memory ✅ (Task 1).

**Placeholders :** les `{/* Section … — JSX actuel inchangé */}` de Task 2 désignent du JSX existant à déplacer verbatim (pas à réécrire) — c'est un déplacement, le code source est la page actuelle ; le nouveau code (CampTabs, section Paiements) est fourni en entier.

**Type consistency :** `recettes: EcritureCampRow[]` cohérent entre Task 1 (def + return) et Task 2 (conso). `selectCampRecettes` même signature partout. `EcritureCampRow` a bien `date_ecriture`, `description`, `category_name`, `amount_cents` (utilisés dans la liste).
