# Remboursements — lien écriture montant différent + virement groupé — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au trésorier de lier une demande de remboursement à une écriture de **montant différent** (virement groupé) et de lier **plusieurs demandes à la même écriture**, via un sélecteur recherchable, avec un indicateur de couverture « N demandes · somme / virement · reste » côté demande et côté écriture.

**Architecture :** On lève les deux verrous applicatifs de `remboursement-ecriture-link.ts` (montant exact + unicité). La sélection passe à un combobox recherchable (composant client réutilisant `@/components/ui/combobox`). Un helper de couverture (pur + variante BDD) alimente les récaps. Le lien reste porté par la FK `remboursements.ecriture_id` (schéma inchangé, plusieurs-à-un déjà supporté par l'affichage).

**Tech Stack :** Next 16 (server components + server actions), TypeScript, libsql/Turso, vitest, Tailwind (design system maison), Base UI combobox.

## Global Constraints

- **Montants en centimes** ; calculs de couverture en **valeur absolue** (les totaux demande sont positifs, le signe éventuel de l'écriture ne doit pas fausser).
- **Aucune contrainte SQL** ajoutée ; le lien reste `remboursements.ecriture_id` (FK simple, pas de UNIQUE).
- **Plusieurs-à-un autorisé** : plusieurs demandes peuvent pointer la même écriture.
- **Sur-lien = avertissement non bloquant** (jamais de refus si la somme dépasse le virement).
- Fichiers `'use client'` = composants client ; fichiers services = pas de `'use server'`.
- Enrichissement `unite_id` de l'écriture : **COALESCE** sur écriture `draft` uniquement, jamais d'écrasement (comportement existant à préserver).
- **Commande de test** : `./node_modules/.bin/vitest run <path>` depuis `web/` (`pnpm` est cassé dans l'environnement). Typecheck : `./node_modules/.bin/tsc --noEmit`. Lint : `./node_modules/.bin/eslint <files>`. Build : `./node_modules/.bin/next build`.
- Terminologie : « ventilation » ici = N demandes → 1 virement. **Ne pas** toucher `ecritures-ventilate.ts` / `ventilation_group_id`.
- Pas de `git push`.

---

### Task 1: Lever les verrous montant + unicité (candidates & lien)

**Files:**
- Modify: `web/src/lib/services/remboursement-ecriture-link.ts` (`EcritureCandidate`, `findEcritureCandidatesForRembs`, `setRembsEcritureLink`)
- Test: `web/src/lib/services/__tests__/remboursement-ecriture-link.test.ts` (nouveau)

**Interfaces:**
- Produces:
  - `EcritureCandidate` gagne `linked_count: number`.
  - `findEcritureCandidatesForRembs(groupId, rembsId)` : plus de filtre montant, plus d'exclusion des déjà-liées, tri par proximité de montant puis date desc, `LIMIT 300`.
  - `setRembsEcritureLink(...)` : plus de contrôle `conflict` (many-to-one autorisé).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/src/lib/services/__tests__/remboursement-ecriture-link.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { findEcritureCandidatesForRembs, setRembsEcritureLink } from '../remboursement-ecriture-link';

const SETUP = `
  CREATE TABLE remboursements (
    id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, total_cents INTEGER,
    date_depense TEXT, unite_id TEXT, ecriture_id TEXT, updated_at TEXT
  );
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT, type TEXT, amount_cents INTEGER,
    date_ecriture TEXT, description TEXT, unite_id TEXT, status TEXT
  );
  CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT);
`;

async function setup(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP);
  // Demande de 100,40 € le 2026-06-30.
  await db.prepare(
    "INSERT INTO remboursements (id, group_id, amount_cents, total_cents, date_depense) VALUES ('RBT-1','g',10040,10040,'2026-06-30')",
  ).run();
  // Autre demande liée au virement groupé.
  await db.prepare(
    "INSERT INTO remboursements (id, group_id, amount_cents, total_cents, date_depense, ecriture_id) VALUES ('RBT-2','g',20000,20000,'2026-06-15','ECR-VIREMENT')",
  ).run();
  // Écriture au montant EXACT de RBT-1.
  await db.prepare(
    "INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status) VALUES ('ECR-EXACT','g','depense',10040,'2026-07-01','Virement Florence','mirror')",
  ).run();
  // Virement GROUPÉ (montant différent), déjà lié à RBT-2.
  await db.prepare(
    "INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status) VALUES ('ECR-VIREMENT','g','depense',50000,'2026-07-02','Virement groupé Florence','mirror')",
  ).run();
  // Recette (jamais candidate) + dépense hors fenêtre.
  await db.prepare(
    "INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status) VALUES ('ECR-REC','g','recette',10040,'2026-07-01','Cotisation','mirror')",
  ).run();
  await db.prepare(
    "INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status) VALUES ('ECR-OLD','g','depense',10040,'2020-01-01','Vieux','mirror')",
  ).run();
  return db;
}

describe('findEcritureCandidatesForRembs', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('renvoie les écritures dépense de montant DIFFÉRENT (plus de filtre montant exact)', async () => {
    const c = await findEcritureCandidatesForRembs('g', 'RBT-1');
    const ids = c.map((x) => x.id);
    expect(ids).toContain('ECR-EXACT');
    expect(ids).toContain('ECR-VIREMENT'); // montant 500 ≠ 100,40
    expect(ids).not.toContain('ECR-REC');  // recette exclue
    expect(ids).not.toContain('ECR-OLD');  // hors fenêtre ±1 an
  });

  it('inclut une écriture déjà liée à une autre demande + expose linked_count', async () => {
    const c = await findEcritureCandidatesForRembs('g', 'RBT-1');
    const virement = c.find((x) => x.id === 'ECR-VIREMENT');
    expect(virement).toBeDefined();
    expect(virement!.linked_count).toBe(1);
  });

  it('trie le match de montant exact en tête', async () => {
    const c = await findEcritureCandidatesForRembs('g', 'RBT-1');
    expect(c[0].id).toBe('ECR-EXACT');
  });
});

describe('setRembsEcritureLink', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('autorise le lien vers une écriture déjà liée à une autre demande', async () => {
    const res = await setRembsEcritureLink('g', 'RBT-1', 'ECR-VIREMENT');
    expect(res.ok).toBe(true);
    const r = await testDb.prepare('SELECT ecriture_id FROM remboursements WHERE id=?').get<{ ecriture_id: string }>('RBT-1');
    expect(r?.ecriture_id).toBe('ECR-VIREMENT');
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/remboursement-ecriture-link.test.ts`
Expected: FAIL — `ECR-VIREMENT` absent (filtre montant exact) / `linked_count` undefined / lien refusé « déjà liée ».

- [ ] **Step 3: Modifier le service**

Dans `web/src/lib/services/remboursement-ecriture-link.ts` :

Ajouter `linked_count` à l'interface :

```ts
export interface EcritureCandidate {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  unite_code: string | null;
  status: string;
  linked_count: number;
}
```

Remplacer le corps de `findEcritureCandidatesForRembs` (à partir de la lecture de `rembs`) par :

```ts
  const rembs = await db
    .prepare(
      `SELECT amount_cents, total_cents, date_depense
       FROM remboursements
       WHERE id = ? AND group_id = ?`,
    )
    .get<{ amount_cents: number; total_cents: number | null; date_depense: string | null }>(rembsId, groupId);

  if (!rembs) return [];
  const target = Math.abs(rembs.total_cents ?? rembs.amount_cents ?? 0);

  const conditions: string[] = ["e.group_id = ?", "e.type = 'depense'"];
  const params: unknown[] = [groupId];

  // Fenêtre date seulement si la demande a une date d'appui.
  if (rembs.date_depense) {
    const baseDate = new Date(rembs.date_depense).getTime();
    const fromDate = new Date(baseDate - DATE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const toDate = new Date(baseDate + DATE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    conditions.push("e.date_ecriture BETWEEN ? AND ?");
    params.push(fromDate, toDate);
  }

  // Plus de filtre de montant ni d'exclusion des écritures déjà liées :
  // un virement groupé (montant ≠ total demande) et une écriture déjà
  // rattachée à une autre demande doivent apparaître. Tri : proximité de
  // montant en tête (match exact d'abord), puis date décroissante.
  return await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.status,
              u.code AS unite_code,
              (SELECT COUNT(*) FROM remboursements r WHERE r.ecriture_id = e.id) AS linked_count
       FROM ecritures e
       LEFT JOIN unites u ON u.id = e.unite_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ABS(ABS(e.amount_cents) - ?) ASC, e.date_ecriture DESC
       LIMIT 300`,
    )
    .all<EcritureCandidate>(...params, target);
```

Dans `setRembsEcritureLink`, **supprimer** le bloc `conflict` (le `SELECT ... WHERE ecriture_id = ? AND id != ?` et le `if (conflict) return {...}`). Garder la vérif d'existence de l'écriture juste au-dessus, et tout le reste (UPDATE + enrichissement unite_id) inchangé.

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/remboursement-ecriture-link.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/remboursement-ecriture-link.ts web/src/lib/services/__tests__/remboursement-ecriture-link.test.ts
git commit -m "feat(rembs): lien écriture — montant libre + plusieurs demandes par écriture"
```

---

### Task 2: Helper de couverture (pur + variante BDD)

**Files:**
- Modify: `web/src/lib/services/remboursement-ecriture-link.ts` (ajout `RembsCoverage`, `computeRembsCoverage`, `getEcritureRembsCoverage`)
- Test: `web/src/lib/services/__tests__/remboursement-ecriture-coverage.test.ts` (nouveau)

**Interfaces:**
- Consumes: `getDb()`.
- Produces:
  - `interface RembsCoverage { nbDemandes; sommeDemandesCents; montantVirementCents; resteCents; depasse }`
  - `computeRembsCoverage(montantVirementCents: number, rembsTotalsCents: number[]): RembsCoverage` (pur).
  - `getEcritureRembsCoverage(groupId: string, ecritureId: string): Promise<RembsCoverage>`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/src/lib/services/__tests__/remboursement-ecriture-coverage.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { computeRembsCoverage, getEcritureRembsCoverage } from '../remboursement-ecriture-link';

describe('computeRembsCoverage (pur)', () => {
  it('couverture exacte : reste 0, pas de dépassement', () => {
    expect(computeRembsCoverage(50000, [30000, 20000])).toEqual({
      nbDemandes: 2, sommeDemandesCents: 50000, montantVirementCents: 50000, resteCents: 0, depasse: false,
    });
  });
  it('sous-couverture : reste positif', () => {
    const c = computeRembsCoverage(50000, [30000]);
    expect(c.resteCents).toBe(20000);
    expect(c.depasse).toBe(false);
  });
  it('sur-couverture : depasse=true, reste négatif', () => {
    const c = computeRembsCoverage(50000, [30000, 30000]);
    expect(c.sommeDemandesCents).toBe(60000);
    expect(c.resteCents).toBe(-10000);
    expect(c.depasse).toBe(true);
  });
  it('0 demande', () => {
    expect(computeRembsCoverage(50000, [])).toMatchObject({ nbDemandes: 0, sommeDemandesCents: 0, resteCents: 50000, depasse: false });
  });
  it('valeur absolue : montant écriture négatif traité comme positif', () => {
    const c = computeRembsCoverage(-50000, [20000]);
    expect(c.montantVirementCents).toBe(50000);
    expect(c.resteCents).toBe(30000);
  });
});

describe('getEcritureRembsCoverage', () => {
  beforeEach(async () => {
    const client: Client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    testDb = wrapClient(client);
    await testDb.exec(`
      CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER);
      CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, total_cents INTEGER, ecriture_id TEXT);
    `);
    await testDb.prepare("INSERT INTO ecritures (id, group_id, amount_cents) VALUES ('ECR','g',50000)").run();
    await testDb.prepare("INSERT INTO remboursements (id, group_id, amount_cents, total_cents, ecriture_id) VALUES ('R1','g',30000,30000,'ECR')").run();
    await testDb.prepare("INSERT INTO remboursements (id, group_id, amount_cents, total_cents, ecriture_id) VALUES ('R2','g',15000,15000,'ECR')").run();
    await testDb.prepare("INSERT INTO remboursements (id, group_id, amount_cents, total_cents, ecriture_id) VALUES ('R3','g',9999,9999,NULL)").run();
  });

  it('somme les totaux des demandes liées vs montant écriture', async () => {
    const c = await getEcritureRembsCoverage('g', 'ECR');
    expect(c.nbDemandes).toBe(2);
    expect(c.sommeDemandesCents).toBe(45000);
    expect(c.montantVirementCents).toBe(50000);
    expect(c.resteCents).toBe(5000);
    expect(c.depasse).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/remboursement-ecriture-coverage.test.ts`
Expected: FAIL — exports `computeRembsCoverage` / `getEcritureRembsCoverage` absents.

- [ ] **Step 3: Ajouter les helpers**

À la fin de `web/src/lib/services/remboursement-ecriture-link.ts` :

```ts
export interface RembsCoverage {
  nbDemandes: number;
  sommeDemandesCents: number;    // Σ |total demande| des demandes liées
  montantVirementCents: number;  // |montant de l'écriture|
  resteCents: number;            // montantVirement - sommeDemandes (peut être < 0)
  depasse: boolean;              // sommeDemandes > montantVirement
}

// Pur : couverture d'un virement par les demandes qui lui sont liées.
// Tout en valeur absolue (totaux demande positifs ; le signe éventuel de
// l'écriture ne doit pas fausser le calcul).
export function computeRembsCoverage(
  montantVirementCents: number,
  rembsTotalsCents: number[],
): RembsCoverage {
  const montant = Math.abs(montantVirementCents);
  const somme = rembsTotalsCents.reduce((s, t) => s + Math.abs(t), 0);
  return {
    nbDemandes: rembsTotalsCents.length,
    sommeDemandesCents: somme,
    montantVirementCents: montant,
    resteCents: montant - somme,
    depasse: somme > montant,
  };
}

// Variante BDD : lit le montant de l'écriture + les totaux des demandes
// liées, puis délègue à computeRembsCoverage.
export async function getEcritureRembsCoverage(
  groupId: string,
  ecritureId: string,
): Promise<RembsCoverage> {
  const db = getDb();
  const ecr = await db
    .prepare('SELECT amount_cents FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ amount_cents: number }>(ecritureId, groupId);
  const rows = await db
    .prepare(
      `SELECT COALESCE(total_cents, amount_cents) AS total
       FROM remboursements
       WHERE group_id = ? AND ecriture_id = ?`,
    )
    .all<{ total: number }>(groupId, ecritureId);
  return computeRembsCoverage(ecr?.amount_cents ?? 0, rows.map((r) => r.total ?? 0));
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/remboursement-ecriture-coverage.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/remboursement-ecriture-link.ts web/src/lib/services/__tests__/remboursement-ecriture-coverage.test.ts
git commit -m "feat(rembs): helper de couverture virement↔demandes liées"
```

---

### Task 3: `totalCents` sur les demandes liées (bundle écriture)

**Files:**
- Modify: `web/src/lib/services/justificatifs.ts` (`EcritureJustifsBundle`, `listJustificatifsForEcriture`)
- Test: `web/src/lib/services/__tests__/justificatifs-ecriture-total.test.ts` (nouveau)

**Interfaces:**
- Produces: `EcritureJustifsBundle.viaRemboursement[]` gagne `totalCents: number`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/src/lib/services/__tests__/justificatifs-ecriture-total.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { listJustificatifsForEcriture } from '../justificatifs';

describe('listJustificatifsForEcriture — totalCents par demande liée', () => {
  beforeEach(async () => {
    const client: Client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    testDb = wrapClient(client);
    await testDb.exec(`
      CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, amount_cents INTEGER, total_cents INTEGER, ecriture_id TEXT);
      CREATE TABLE justificatifs (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, file_path TEXT NOT NULL, original_filename TEXT NOT NULL, mime_type TEXT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, uploaded_at TEXT);
    `);
    await testDb.prepare("INSERT INTO remboursements (id, group_id, demandeur, amount_cents, total_cents, ecriture_id) VALUES ('R1','g','Florence',30000,30000,'ECR')").run();
    await testDb.prepare("INSERT INTO remboursements (id, group_id, demandeur, amount_cents, total_cents, ecriture_id) VALUES ('R2','g','Florence',20000,20000,'ECR')").run();
  });

  it('chaque demande liée porte son total en centimes', async () => {
    const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'ECR');
    const totby = Object.fromEntries(bundle.viaRemboursement.map((r) => [r.remboursementId, r.totalCents]));
    expect(totby).toEqual({ R1: 30000, R2: 20000 });
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/justificatifs-ecriture-total.test.ts`
Expected: FAIL — `totalCents` absent (undefined).

- [ ] **Step 3: Enrichir le bundle**

Dans `web/src/lib/services/justificatifs.ts` :

Interface `EcritureJustifsBundle.viaRemboursement` — ajouter `totalCents` :

```ts
  viaRemboursement: {
    remboursementId: string;
    demandeur: string | null;
    totalCents: number;
    justifs: Justificatif[];
    rib: Justificatif[];
  }[];
```

Dans `listJustificatifsForEcriture`, la requête `linkedRembs` — ajouter les totaux :

```ts
  const linkedRembs = await db
    .prepare(
      `SELECT id, demandeur, total_cents, amount_cents FROM remboursements
       WHERE group_id = ? AND ecriture_id = ?
       ORDER BY id`,
    )
    .all<{ id: string; demandeur: string | null; total_cents: number | null; amount_cents: number | null }>(groupId, ecritureId);
```

Et dans le `map` qui construit `viaRemboursement`, renseigner `totalCents` :

```ts
      return {
        remboursementId: r.id,
        demandeur: r.demandeur,
        totalCents: r.total_cents ?? r.amount_cents ?? 0,
        justifs: all.filter((j) => j.entity_type === 'remboursement'),
        rib: all.filter((j) => j.entity_type === 'remboursement_rib'),
      };
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/justificatifs-ecriture-total.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Vérifier qu'aucun consommateur du bundle ne casse au typecheck**

Run: `cd web && ./node_modules/.bin/tsc --noEmit`
Expected: clean (l'ajout d'un champ requis à un objet construit en un seul endroit ne casse pas les lecteurs).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/services/justificatifs.ts web/src/lib/services/__tests__/justificatifs-ecriture-total.test.ts
git commit -m "feat(rembs): total de chaque demande liée exposé côté écriture (bundle)"
```

---

### Task 4: Picker combobox + couverture côté demande

**Files:**
- Create: `web/src/components/rembs/ecriture-link-picker.tsx`
- Modify: `web/src/components/rembs/ecriture-link-card.tsx`

**Interfaces:**
- Consumes: `EcritureCandidate` (avec `linked_count`, Task 1), `getEcritureRembsCoverage` (Task 2), `linkRemboursementToEcriture` (existant), `Combobox` / `ComboboxItem` (`@/components/ui/combobox`).

- [ ] **Step 1: Créer le picker client**

Créer `web/src/components/rembs/ecriture-link-picker.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { Combobox, type ComboboxItem } from '@/components/ui/combobox';
import { PendingButton } from '@/components/shared/pending-button';
import { Field } from '@/components/shared/field';

// Sélecteur recherchable d'écriture à lier. La server action bindée est
// passée en prop (`action`) ; on pose la sélection dans un input caché
// `ecriture_id` que l'action lit dans le FormData. Submit désactivé tant
// qu'aucune écriture n'est choisie.
export function EcritureLinkPicker({
  rembsId,
  items,
  action,
}: {
  rembsId: string;
  items: ComboboxItem[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [value, setValue] = useState('');
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="ecriture_id" value={value} />
      <Field label="Écriture (virement)" htmlFor={`ecriture-${rembsId}`}>
        <Combobox
          id={`ecriture-${rembsId}`}
          items={items}
          value={value}
          onValueChange={setValue}
          placeholder="— Choisir une écriture —"
          searchPlaceholder="Rechercher par date, montant, libellé…"
          ariaLabel="Écriture à lier"
        />
      </Field>
      <div className="flex justify-end">
        <PendingButton size="sm" pendingLabel="Liaison…" disabled={!value}>
          Lier à cette écriture
        </PendingButton>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Rewire `EcritureLinkCard` (sélection + vue liée)**

Dans `web/src/components/rembs/ecriture-link-card.tsx` :

Remplacer les imports `NativeSelect` par le picker et le helper de couverture, ajouter `formatAmount` :

```ts
import Link from 'next/link';
import { ArrowRight, Receipt, Unlink } from 'lucide-react';
import { PendingButton } from '@/components/shared/pending-button';
import { Section } from '@/components/shared/section';
import { Alert } from '@/components/ui/alert';
import { Amount } from '@/components/shared/amount';
import { formatAmount } from '@/lib/format';
import { type ComboboxItem } from '@/components/ui/combobox';
import {
  findEcritureCandidatesForRembs,
  getEcritureRembsCoverage,
} from '@/lib/services/remboursement-ecriture-link';
import {
  linkRemboursementToEcriture,
  unlinkRemboursementFromEcriture,
} from '@/lib/actions/remboursements';
import { EcritureLinkPicker } from './ecriture-link-picker';
```

Dans `EcritureLinkCard`, passer `groupId` à `LinkedView` et construire les items combobox :

```tsx
  if (ecritureId) {
    return <LinkedView rembsId={rembsId} ecritureId={ecritureId} amountCents={amountCents} groupId={groupId} />;
  }

  const candidates = await findEcritureCandidatesForRembs(groupId, rembsId);
  const items: ComboboxItem[] = candidates.map((c) => {
    const montant = (c.amount_cents / 100).toFixed(2).replace('.', ',');
    const desc = c.description.length > 40 ? c.description.slice(0, 40) + '…' : c.description;
    const dejaLie = c.linked_count > 0 ? ` · déjà ${c.linked_count} liée${c.linked_count > 1 ? 's' : ''}` : '';
    return {
      value: c.id,
      label: `${c.date_ecriture} · ${montant} €${c.unite_code ? ` · ${c.unite_code}` : ''} · ${desc}${dejaLie}`,
    };
  });

  return (
    <Section
      title="Écriture comptable"
      subtitle="Lie cette demande au virement comptable correspondant."
    >
      {candidates.length === 0 ? (
        <Alert variant="info" icon={Receipt}>
          Aucune écriture dépense trouvée dans une fenêtre de ±1 an. Le virement n&apos;a
          peut-être pas encore été importé depuis Comptaweb.
        </Alert>
      ) : (
        <EcritureLinkPicker
          rembsId={rembsId}
          items={items}
          action={linkRemboursementToEcriture.bind(null, rembsId)}
        />
      )}
    </Section>
  );
```

Remplacer `LinkedView` par une version qui affiche la couverture :

```tsx
async function LinkedView({
  rembsId,
  ecritureId,
  amountCents,
  groupId,
}: {
  rembsId: string;
  ecritureId: string;
  amountCents: number;
  groupId: string;
}) {
  const cov = await getEcritureRembsCoverage(groupId, ecritureId);
  return (
    <Section title="Écriture comptable liée">
      <Link
        href={`/ecritures/${ecritureId}`}
        className="flex items-center gap-2.5 rounded-md border border-brand-100 bg-brand-50/40 px-3 py-2.5 hover:bg-brand-50 transition-colors group"
      >
        <Receipt size={16} strokeWidth={1.75} className="text-brand shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium font-mono text-fg">{ecritureId}</div>
          <div className="text-[12px] text-fg-muted">
            <Amount cents={amountCents} tone="negative" />
          </div>
        </div>
        <ArrowRight size={14} strokeWidth={2} className="text-fg-subtle group-hover:text-brand transition-colors" />
      </Link>

      {cov.nbDemandes > 1 && (
        <p className="mt-2 text-[12px] text-fg-muted">
          Ce virement de {formatAmount(cov.montantVirementCents)} couvre {cov.nbDemandes} demandes ·{' '}
          {formatAmount(cov.sommeDemandesCents)}
          {!cov.depasse && cov.resteCents !== 0 && <> · reste {formatAmount(cov.resteCents)}</>}
        </p>
      )}
      {cov.depasse && (
        <Alert variant="warning" className="mt-2">
          La somme des demandes liées ({formatAmount(cov.sommeDemandesCents)}) dépasse le virement
          ({formatAmount(cov.montantVirementCents)}).
        </Alert>
      )}

      <form action={unlinkRemboursementFromEcriture.bind(null, rembsId)} className="pt-1">
        <PendingButton variant="ghost" size="sm" className="text-fg-muted hover:text-destructive">
          <Unlink size={13} strokeWidth={2} className="mr-1.5" />
          Délier
        </PendingButton>
      </form>
    </Section>
  );
}
```

(Le `Field` importé n'est plus utilisé dans `ecriture-link-card.tsx` — le retirer de l'import ; il vit maintenant dans le picker.)

- [ ] **Step 3: Vérifier build + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/components/rembs/ecriture-link-picker.tsx src/components/rembs/ecriture-link-card.tsx && ./node_modules/.bin/next build`
Expected: tsc clean, eslint clean, build compile la route `/remboursements/[id]`.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/rembs/ecriture-link-picker.tsx web/src/components/rembs/ecriture-link-card.tsx
git commit -m "feat(rembs): sélecteur d'écriture recherchable + couverture côté demande"
```

---

### Task 5: Bandeau de couverture côté écriture

**Files:**
- Modify: `web/src/components/ecritures/justificatifs-card.tsx`

**Interfaces:**
- Consumes: `computeRembsCoverage` (Task 2), `EcritureJustifsBundle.viaRemboursement[].totalCents` (Task 3), `ecritureAmountCents` (prop existante).

- [ ] **Step 1: Ajouter l'import + le calcul de couverture**

Dans `web/src/components/ecritures/justificatifs-card.tsx`, ajouter l'import :

```ts
import { computeRembsCoverage } from '@/lib/services/remboursement-ecriture-link';
```

Dans le corps du composant (après le calcul de `totalCount`, avant le `return`), ajouter :

```ts
  const rembsTotals = bundle.viaRemboursement.map((r) => r.totalCents);
  const coverage = rembsTotals.length > 0
    ? computeRembsCoverage(ecritureAmountCents, rembsTotals)
    : null;
```

- [ ] **Step 2: Afficher le bandeau au-dessus des demandes liées**

Toujours dans `justificatifs-card.tsx`, juste AVANT le `{bundle.viaRemboursement.map((rb) => (` (le bloc « Justifs via remboursement lié »), insérer :

```tsx
      {coverage && (
        <div
          className={
            coverage.depasse
              ? 'mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200'
              : 'mt-1.5 text-[12px] text-fg-muted'
          }
        >
          {coverage.nbDemandes} demande{coverage.nbDemandes > 1 ? 's' : ''} liée{coverage.nbDemandes > 1 ? 's' : ''} ·{' '}
          {formatAmount(coverage.sommeDemandesCents)} / {formatAmount(coverage.montantVirementCents)}
          {coverage.depasse
            ? ' · dépasse le virement'
            : coverage.resteCents !== 0
              ? ` · reste ${formatAmount(coverage.resteCents)}`
              : ''}
        </div>
      )}
```

(`formatAmount` est déjà importé dans ce fichier.)

- [ ] **Step 3: Vérifier build + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/components/ecritures/justificatifs-card.tsx && ./node_modules/.bin/next build`
Expected: tsc clean, eslint clean, build OK.

- [ ] **Step 4: Smoke manuel (contrôleur)**

Le contrôleur (ou l'utilisateur) vérifie en prod/dev, connecté trésorier :
- Sur une demande non liée : le sélecteur d'écriture est un champ recherchable ; on peut choisir une écriture de montant différent (ex. le virement groupé) et lier.
- Lier la même écriture à 2+ demandes : plus d'erreur « déjà liée ».
- Vue liée (demande) : « Ce virement de X couvre N demandes · somme · reste Y » ; avertissement si somme > virement.
- Fiche écriture : bandeau « N demandes liées · somme / virement · reste » (ambre si dépassement).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ecritures/justificatifs-card.tsx
git commit -m "feat(rembs): bandeau de couverture des demandes liées côté écriture"
```

---

## Self-Review

**Spec coverage :**
- Bloc 1 (lever verrous montant + unicité, linked_count) → Task 1. ✅
- Bloc 2 (computeRembsCoverage + getEcritureRembsCoverage) → Task 2. ✅
- Bloc 3 (combobox recherchable + couverture/avertissement côté demande) → Task 4 (+ picker). ✅
- Bloc 4 (bundle totalCents + bandeau côté écriture) → Task 3 + Task 5. ✅
- Hors scope respecté : pas de `ecritures-ventilate`, pas de contrainte SQL, pas de MCP, sur-lien non bloquant. ✅

**Placeholders :** aucun ; code complet fourni pour chaque step de code.

**Cohérence des types :**
- `EcritureCandidate.linked_count` (Task 1) consommé par Task 4 (label items).
- `RembsCoverage` (Task 2) consommé par Task 4 (`getEcritureRembsCoverage`) et Task 5 (`computeRembsCoverage`).
- `viaRemboursement[].totalCents` (Task 3) consommé par Task 5.
- `EcritureLinkPicker` prop `action: (formData: FormData) => void | Promise<void>` alimentée par `linkRemboursementToEcriture.bind(null, rembsId)` (signature `(rbtId, formData)` → bindée en `(formData)`).

**Risque noté :** le plafond `LIMIT 300` du combobox peut masquer une écriture très ancienne/atypique hors des 300 plus proches en montant. Acceptable au volume d'un groupe (± quelques centaines d'écritures/an) ; la recherche par libellé/date reste dispo sur les 300 chargées. Si un groupe dépasse, une recherche server-side serait le prochain palier (hors scope ici).
