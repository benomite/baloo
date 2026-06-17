# Frais kilométriques — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre des lignes de remboursement « kilométriques » (saisie de km, montant = km × taux du groupe figé par ligne), avec taux éditable en admin, carte grise rappelée, et rendu détail + PDF.

**Architecture:** Une fonction pure de calcul km, des colonnes ajoutées à `remboursement_lignes` (type/distance/taux figé) et `groupes` (taux courant), le calcul du montant km côté serveur dans les actions create/edit, un sélecteur de type par ligne dans le formulaire, et une petite page admin pour le taux.

**Tech Stack:** Next.js 16 (Server Components + server actions, `useActionState`), libsql/Turso, pdfkit, Vitest. Montants en centimes ; taux en millièmes d'euro ; distance en dixièmes de km.

---

## Contexte indispensable (à lire avant de coder)

- Code applicatif sous `web/`. Commandes depuis `web/` avec `npx` (`npx vitest run …`, `npx tsc --noEmit`). Branche : `feat/frais-kilometriques`.
- Lire `web/AGENTS.md` : migrations Turso = `ALTER TABLE ADD COLUMN` nullable + backfill (pas de `NOT NULL DEFAULT`), `CREATE INDEX` après l'ALTER dans `auth/schema.ts`, pas de CHECK SQL sur des champs de workflow, `force-dynamic` sur pages auth.
- **Pattern test DB** (`src/lib/services/__tests__/ecritures-create.test.ts`) : `createClient({ url: 'file::memory:' })` + `wrapClient` ; services injectables ou via `getDb()`.
- **Unités** : distance en **dixièmes de km** (`distance_km_dixiemes`, 125 = 12,5 km) ; taux en **millièmes d'euro/km** (`taux_km_millicents`, 354 = 0,354 €/km) ; montant en **centimes**.
- **Formule** : `amount_cents = Math.round(distance_km_dixiemes * taux_km_millicents / 100)`.
- **Lignes** : le formulaire envoie `ligne_count` + `ligne_${i}_date`, `ligne_${i}_nature`, `ligne_${i}_montant` ; `parseLignesFromForm` (`src/lib/actions/remboursements/_helpers.ts`) les parse en `LigneInput[]` ; les actions `create.ts`/`update.ts` appellent `addLigne` par ligne.
- **NE PAS modifier `computeRemboursementHash`** (`src/lib/services/remboursements.ts`) : son JSON canonique inclut déjà `amount_cents`/`nature`/`date`/`notes`. Le montant km y est capté via `amount_cents`. Ajouter distance/taux changerait le hash de TOUTES les demandes signées existantes → chaînes de signatures « brisées ». On laisse la fonction telle quelle.
- **PDF** (`src/lib/pdf/feuille-remboursement.ts`) : table simple `Date | Nature | Montant` (PAS les 4 colonnes de la fiche officielle SGDF). Le détail km va **inline dans la Nature** (« … (120 km × 0,354 €/km) »), pas dans une nouvelle colonne.

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/services/km.ts` *(create)* | Fonctions pures : parse distance, calcul montant, formatage taux/distance. |
| `src/lib/services/km.test.ts` *(create)* | Tests du calcul. |
| `src/lib/auth/schema.ts` *(modif)* | Migrations colonnes `remboursement_lignes` + `groupes`. |
| `src/lib/auth/km-migration.test.ts` *(create)* | Test migration. |
| `src/lib/services/remboursements.ts` *(modif)* | `RemboursementLigne`/`CreateLigneInput` + `addLigne` stockent type/distance/taux. |
| `src/lib/services/groupes.ts` *(modif)* | `Groupe`/`UpdateGroupeInput` gagnent `taux_km_millicents`. |
| `src/lib/actions/remboursements/_helpers.ts` *(modif)* | `LigneInput` + `parseLignesFromForm` (type/km) + `resolveLignesWithRate`. |
| `src/lib/actions/remboursements/_helpers.test.ts` *(create)* | Tests parsing + resolve. |
| `src/lib/actions/remboursements/create.ts` + `update.ts` *(modif)* | Lisent le taux groupe, stockent lignes km. |
| `src/components/rembs/remboursement-form.tsx` *(modif)* | Sélecteur type/ligne + champ km + rappel carte grise. |
| `src/app/(app)/remboursements/nouveau/page.tsx` + `[id]/edit/page.tsx` *(modif)* | Passent le taux courant ; edit pré-remplit type/distance. |
| `src/app/(app)/remboursements/[id]/page.tsx` *(modif)* | Rendu détail des lignes km. |
| `src/lib/pdf/feuille-remboursement.ts` *(modif)* | Détail km inline + rappel taux. |
| `src/app/(app)/admin/parametres/page.tsx` + action *(create)* | Champ taux du km (admin). |
| `src/components/layout/nav-config.ts` *(modif)* | Entrée « Paramètres » (Administration). |

---

## Task 1 : Module de calcul km (pur)

**Files:**
- Create: `src/lib/services/km.ts`
- Test: `src/lib/services/km.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `src/lib/services/km.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  parseDistanceToDixiemes,
  computeKmAmountCents,
  formatKmRate,
  formatDistance,
} from './km';

describe('km — parseDistanceToDixiemes', () => {
  it('parse les entiers et décimales (virgule ou point)', () => {
    expect(parseDistanceToDixiemes('100')).toBe(1000);
    expect(parseDistanceToDixiemes('12,5')).toBe(125);
    expect(parseDistanceToDixiemes('12.5')).toBe(125);
    expect(parseDistanceToDixiemes(' 8,4 ')).toBe(84);
  });
  it('arrondit au dixième', () => {
    expect(parseDistanceToDixiemes('12,54')).toBe(125);
    expect(parseDistanceToDixiemes('12,56')).toBe(126);
  });
  it('rejette une saisie invalide ou <= 0', () => {
    expect(() => parseDistanceToDixiemes('')).toThrow();
    expect(() => parseDistanceToDixiemes('abc')).toThrow();
    expect(() => parseDistanceToDixiemes('0')).toThrow();
    expect(() => parseDistanceToDixiemes('-5')).toThrow();
  });
});

describe('km — computeKmAmountCents', () => {
  it('100 km au taux 0,354 → 35,40 €', () => {
    expect(computeKmAmountCents(1000, 354)).toBe(3540);
  });
  it('12,5 km au taux 0,354 → 4,43 € (arrondi)', () => {
    expect(computeKmAmountCents(125, 354)).toBe(443);
  });
  it('taux alternatif 0,40 €/km, 50 km → 20,00 €', () => {
    expect(computeKmAmountCents(500, 400)).toBe(2000);
  });
});

describe('km — formatage', () => {
  it('formatKmRate affiche le taux en euros', () => {
    expect(formatKmRate(354)).toBe('0,354 €');
  });
  it('formatDistance affiche la distance en km', () => {
    expect(formatDistance(1000)).toBe('100 km');
    expect(formatDistance(125)).toBe('12,5 km');
  });
});
```

- [ ] **Step 2 : Lancer (échoue)** — `cd web && npx vitest run src/lib/services/km.test.ts` → module absent.

- [ ] **Step 3 : Implémenter `src/lib/services/km.ts`**

```ts
// Frais kilométriques : helpers purs (sans BDD), importables côté serveur
// ET client. Unités : distance en dixièmes de km, taux en millièmes
// d'euro/km, montant en centimes.

// Parse une distance saisie ("12,5", "100", "12.5") en dixièmes de km.
// Lève si invalide ou <= 0.
export function parseDistanceToDixiemes(raw: string): number {
  const cleaned = raw.trim().replace(',', '.').replace(/\s/g, '');
  const km = Number(cleaned);
  if (cleaned === '' || !isFinite(km) || km <= 0) {
    throw new Error(`Distance invalide : « ${raw} »`);
  }
  return Math.round(km * 10);
}

// Montant en centimes = round(dixièmes de km × millièmes €/km / 100).
export function computeKmAmountCents(
  distanceKmDixiemes: number,
  tauxKmMillicents: number,
): number {
  return Math.round((distanceKmDixiemes * tauxKmMillicents) / 100);
}

// Affiche un taux (millièmes d'euro) en euros : 354 → "0,354 €".
export function formatKmRate(tauxKmMillicents: number): string {
  return `${(tauxKmMillicents / 1000).toFixed(3).replace('.', ',')} €`;
}

// Affiche une distance (dixièmes de km) en km : 1000 → "100 km", 125 → "12,5 km".
export function formatDistance(distanceKmDixiemes: number): string {
  const km = distanceKmDixiemes / 10;
  const txt = Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ',');
  return `${txt} km`;
}
```

- [ ] **Step 4 : Lancer (passe)** — `cd web && npx vitest run src/lib/services/km.test.ts`.

- [ ] **Step 5 : Commit**
```bash
git add web/src/lib/services/km.ts web/src/lib/services/km.test.ts
git commit -m "feat(km): module pur de calcul des frais kilométriques"
```

---

## Task 2 : Migration BDD + types service

**Files:**
- Modify: `src/lib/auth/schema.ts`
- Modify: `src/lib/services/remboursements.ts`
- Modify: `src/lib/services/groupes.ts`
- Test: `src/lib/auth/km-migration.test.ts` (create)

- [ ] **Step 1 : Écrire le test de migration (échoue)**

Créer `src/lib/auth/km-migration.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { migrateKmColumns } from './schema';

const SETUP_SQL = `
  CREATE TABLE remboursement_lignes (
    id TEXT PRIMARY KEY,
    remboursement_id TEXT NOT NULL,
    date_depense TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    nature TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature)
    VALUES ('l1','r1','2026-05-09', 3704, 'Courses');
  CREATE TABLE groupes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    nom TEXT NOT NULL
  );
  INSERT INTO groupes (id, code, nom) VALUES ('g1','VDS','Val de Saône');
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  return wrapClient(client);
}

describe('migrateKmColumns', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('ajoute les colonnes km aux lignes ; lignes existantes en type depense', async () => {
    await migrateKmColumns(db);
    const row = await db
      .prepare("SELECT type, distance_km_dixiemes, taux_km_millicents FROM remboursement_lignes WHERE id='l1'")
      .get<{ type: string; distance_km_dixiemes: number | null; taux_km_millicents: number | null }>();
    expect(row?.type).toBe('depense');
    expect(row?.distance_km_dixiemes).toBeNull();
    expect(row?.taux_km_millicents).toBeNull();
  });

  it('ajoute taux_km_millicents au groupe avec défaut 354', async () => {
    await migrateKmColumns(db);
    const g = await db
      .prepare("SELECT taux_km_millicents FROM groupes WHERE id='g1'")
      .get<{ taux_km_millicents: number }>();
    expect(g?.taux_km_millicents).toBe(354);
  });

  it('est idempotent', async () => {
    await migrateKmColumns(db);
    await migrateKmColumns(db);
    const g = await db.prepare("SELECT taux_km_millicents FROM groupes WHERE id='g1'").get<{ taux_km_millicents: number }>();
    expect(g?.taux_km_millicents).toBe(354);
  });
});
```

- [ ] **Step 2 : Lancer (échoue)** — `cd web && npx vitest run src/lib/auth/km-migration.test.ts` → `migrateKmColumns` absent.

- [ ] **Step 3 : Ajouter `migrateKmColumns` dans `schema.ts` + l'appeler**

Dans `src/lib/auth/schema.ts` (qui importe déjà `getDb, type DbWrapper` depuis `../db` — sinon adapter l'import), ajouter une fonction exportée (près des autres migrations) :

```ts
// Frais kilométriques (spec 2026-06-17). Idempotent. Colonnes nullable +
// backfill (pas de NOT NULL DEFAULT — cf. piège Turso). Pas de CHECK SQL.
export async function migrateKmColumns(db: DbWrapper): Promise<void> {
  const ligneCols = await db.prepare('PRAGMA table_info(remboursement_lignes)').all<{ name: string }>();
  const hasLigne = (n: string) => ligneCols.some((c) => c.name === n);
  if (!hasLigne('type')) {
    await db.exec("ALTER TABLE remboursement_lignes ADD COLUMN type TEXT DEFAULT 'depense'");
    await db.exec("UPDATE remboursement_lignes SET type = 'depense' WHERE type IS NULL");
  }
  if (!hasLigne('distance_km_dixiemes')) {
    await db.exec('ALTER TABLE remboursement_lignes ADD COLUMN distance_km_dixiemes INTEGER');
  }
  if (!hasLigne('taux_km_millicents')) {
    await db.exec('ALTER TABLE remboursement_lignes ADD COLUMN taux_km_millicents INTEGER');
  }

  const groupeCols = await db.prepare('PRAGMA table_info(groupes)').all<{ name: string }>();
  if (!groupeCols.some((c) => c.name === 'taux_km_millicents')) {
    await db.exec('ALTER TABLE groupes ADD COLUMN taux_km_millicents INTEGER DEFAULT 354');
    await db.exec('UPDATE groupes SET taux_km_millicents = 354 WHERE taux_km_millicents IS NULL');
  }
}
```

Puis, dans `ensureAuthSchema`, à la fin (juste avant `ensured = true;`), ajouter :
```ts
  await migrateKmColumns(db);
```
(Vérifier que `DbWrapper` est importé ; si l'import est `import { getDb } from '../db';`, le remplacer par `import { getDb, type DbWrapper } from '../db';`.)

- [ ] **Step 4 : Étendre les types du service `remboursements.ts`**

(a) `RemboursementLigne` interface → ajouter :
```ts
  type: string;
  distance_km_dixiemes: number | null;
  taux_km_millicents: number | null;
```
(b) `CreateLigneInput` → ajouter (optionnels, défaut depense) :
```ts
  type?: 'depense' | 'km';
  distance_km_dixiemes?: number | null;
  taux_km_millicents?: number | null;
```
(c) `addLigne` : INSERT inclut les nouvelles colonnes. Remplacer le corps de `addLigne` par :
```ts
export async function addLigne(
  remboursementId: string,
  input: CreateLigneInput,
): Promise<RemboursementLigne> {
  const db = getDb();
  const id = randomUUID();
  const now = currentTimestamp();
  await db.prepare(
    `INSERT INTO remboursement_lignes
       (id, remboursement_id, date_depense, amount_cents, nature, notes, type, distance_km_dixiemes, taux_km_millicents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    remboursementId,
    input.date_depense,
    input.amount_cents,
    input.nature,
    nullIfEmpty(input.notes),
    input.type ?? 'depense',
    input.distance_km_dixiemes ?? null,
    input.taux_km_millicents ?? null,
    now,
  );
  await recalcTotal(remboursementId);
  return (await db.prepare('SELECT * FROM remboursement_lignes WHERE id = ?').get<RemboursementLigne>(id))!;
}
```
(Ne PAS toucher `computeRemboursementHash`.)

- [ ] **Step 5 : Étendre `groupes.ts`**

(a) `Groupe` interface → ajouter `taux_km_millicents: number;`.
(b) `UpdateGroupeInput` → ajouter `taux_km_millicents?: number;`.
(La fonction `updateGroupe` itère `Object.entries(patch)` → la nouvelle clé est gérée automatiquement.)

- [ ] **Step 6 : Lancer migration test + suite**

Run: `cd web && npx vitest run src/lib/auth/km-migration.test.ts && npx tsc --noEmit`
Expected: migration test PASS ; tsc clean.

- [ ] **Step 7 : Commit**
```bash
git add web/src/lib/auth/schema.ts web/src/lib/auth/km-migration.test.ts web/src/lib/services/remboursements.ts web/src/lib/services/groupes.ts
git commit -m "feat(km): colonnes BDD (lignes + groupe taux) + types service"
```

---

## Task 3 : Parsing du formulaire + résolution du montant

**Files:**
- Modify: `src/lib/actions/remboursements/_helpers.ts`
- Modify: `src/lib/actions/remboursements/create.ts`
- Modify: `src/lib/actions/remboursements/update.ts`
- Test: `src/lib/actions/remboursements/_helpers.test.ts` (create)

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `src/lib/actions/remboursements/_helpers.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { parseLignesFromForm, resolveLignesWithRate } from './_helpers';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const fail = (msg: string): never => {
  throw new Error(msg);
};

describe('parseLignesFromForm — type depense / km', () => {
  it('parse une ligne dépense (montant)', () => {
    const lignes = parseLignesFromForm(
      fd({ ligne_count: '1', ligne_0_type: 'depense', ligne_0_date: '2026-05-09', ligne_0_nature: 'Courses', ligne_0_montant: '37,04' }),
      fail,
    );
    expect(lignes[0]).toMatchObject({ type: 'depense', amount_cents: 3704, distance_km_dixiemes: null });
  });

  it('parse une ligne km (distance, montant ignoré)', () => {
    const lignes = parseLignesFromForm(
      fd({ ligne_count: '1', ligne_0_type: 'km', ligne_0_date: '2026-05-09', ligne_0_nature: 'Trajet', ligne_0_km: '120' }),
      fail,
    );
    expect(lignes[0]).toMatchObject({ type: 'km', distance_km_dixiemes: 1200, amount_cents: 0 });
  });

  it('défaut depense si type absent (rétrocompat)', () => {
    const lignes = parseLignesFromForm(
      fd({ ligne_count: '1', ligne_0_date: '2026-05-09', ligne_0_nature: 'X', ligne_0_montant: '10,00' }),
      fail,
    );
    expect(lignes[0].type).toBe('depense');
  });

  it('échoue si ligne km sans distance', () => {
    expect(() =>
      parseLignesFromForm(
        fd({ ligne_count: '1', ligne_0_type: 'km', ligne_0_date: '2026-05-09', ligne_0_nature: 'Trajet' }),
        fail,
      ),
    ).toThrow();
  });
});

describe('resolveLignesWithRate', () => {
  it('calcule le montant des lignes km au taux fourni et fige le taux', () => {
    const resolved = resolveLignesWithRate(
      [
        { type: 'depense', date: '2026-05-09', nature: 'Courses', amount_cents: 3704, distance_km_dixiemes: null },
        { type: 'km', date: '2026-05-09', nature: 'Trajet', amount_cents: 0, distance_km_dixiemes: 1200 },
      ],
      354,
    );
    expect(resolved[0]).toMatchObject({ type: 'depense', amount_cents: 3704, distance_km_dixiemes: null, taux_km_millicents: null });
    expect(resolved[1]).toMatchObject({ type: 'km', amount_cents: 4248, distance_km_dixiemes: 1200, taux_km_millicents: 354 });
  });
});
```

- [ ] **Step 2 : Lancer (échoue)** — `cd web && npx vitest run src/lib/actions/remboursements/_helpers.test.ts`.

- [ ] **Step 3 : Étendre `_helpers.ts`**

(a) Ajouter l'import en tête :
```ts
import { parseDistanceToDixiemes, computeKmAmountCents } from '../../services/km';
```
(b) Remplacer l'interface `LigneInput` par :
```ts
export interface LigneInput {
  type: 'depense' | 'km';
  date: string;
  nature: string;
  amount_cents: number;            // dépense : saisi ; km : 0 jusqu'à résolution
  distance_km_dixiemes: number | null;
}
```
(c) Remplacer `parseLignesFromForm` par :
```ts
export function parseLignesFromForm(
  formData: FormData,
  fail: (msg: string) => never,
): LigneInput[] {
  const ligneCount = parseInt((formData.get('ligne_count') as string | null) ?? '0', 10);
  if (!ligneCount || ligneCount < 1) fail('Au moins une ligne de dépense est requise.');

  const lignes: LigneInput[] = [];
  for (let i = 0; i < ligneCount; i++) {
    const type = ((formData.get(`ligne_${i}_type`) as string | null) ?? 'depense') === 'km' ? 'km' : 'depense';
    const date = (formData.get(`ligne_${i}_date`) as string | null) ?? '';
    const nature = ((formData.get(`ligne_${i}_nature`) as string | null) ?? '').trim();
    if (!date || !nature) fail(`Ligne ${i + 1} incomplète.`);

    if (type === 'km') {
      const kmRaw = ((formData.get(`ligne_${i}_km`) as string | null) ?? '').trim();
      if (!kmRaw) fail(`Ligne ${i + 1} : nombre de km requis.`);
      let distance_km_dixiemes: number;
      try {
        distance_km_dixiemes = parseDistanceToDixiemes(kmRaw);
      } catch {
        fail(`Ligne ${i + 1} : distance invalide « ${kmRaw} ».`);
        return null as never;
      }
      lignes.push({ type: 'km', date, nature, amount_cents: 0, distance_km_dixiemes });
    } else {
      const montantRaw = ((formData.get(`ligne_${i}_montant`) as string | null) ?? '').trim();
      if (!montantRaw) fail(`Ligne ${i + 1} incomplète.`);
      let amount_cents: number;
      try {
        amount_cents = parseAmount(montantRaw);
      } catch {
        fail(`Ligne ${i + 1} : montant invalide « ${montantRaw} ».`);
        return null as never;
      }
      lignes.push({ type: 'depense', date, nature, amount_cents, distance_km_dixiemes: null });
    }
  }
  return lignes;
}
```
(d) Ajouter `ResolvedLigne` + `resolveLignesWithRate` :
```ts
export interface ResolvedLigne {
  type: 'depense' | 'km';
  date: string;
  nature: string;
  amount_cents: number;
  distance_km_dixiemes: number | null;
  taux_km_millicents: number | null;
}

// Calcule le montant des lignes km au taux fourni (figé sur la ligne).
// Les lignes dépense gardent leur montant saisi.
export function resolveLignesWithRate(
  lignes: LigneInput[],
  tauxKmMillicents: number,
): ResolvedLigne[] {
  return lignes.map((l) =>
    l.type === 'km'
      ? {
          type: 'km' as const,
          date: l.date,
          nature: l.nature,
          amount_cents: computeKmAmountCents(l.distance_km_dixiemes ?? 0, tauxKmMillicents),
          distance_km_dixiemes: l.distance_km_dixiemes,
          taux_km_millicents: tauxKmMillicents,
        }
      : {
          type: 'depense' as const,
          date: l.date,
          nature: l.nature,
          amount_cents: l.amount_cents,
          distance_km_dixiemes: null,
          taux_km_millicents: null,
        },
  );
}
```

- [ ] **Step 4 : Lancer (passe)** — `cd web && npx vitest run src/lib/actions/remboursements/_helpers.test.ts`.

- [ ] **Step 5 : Utiliser le taux dans `create.ts`**

Dans `src/lib/actions/remboursements/create.ts` :
(a) Ajouter l'import :
```ts
import { getGroupe } from '../../services/groupes';
import { resolveLignesWithRate } from './_helpers';
```
(`resolveLignesWithRate` s'ajoute à l'import existant depuis `./_helpers`.)
(b) Après `const lignes = parseLignesFromForm(formData, fail);`, résoudre avec le taux du groupe :
```ts
  const groupe = await getGroupe({ groupId: ctx.groupId });
  const tauxKm = groupe?.taux_km_millicents ?? 354;
  const resolvedLignes = resolveLignesWithRate(lignes, tauxKm);
```
(c) Remplacer `const totalEstime = lignes.reduce((s, l) => s + l.amount_cents, 0);` par `const totalEstime = resolvedLignes.reduce((s, l) => s + l.amount_cents, 0);`.
(d) Remplacer la boucle `for (const l of lignes) { await addLigne(created.id, { date_depense: l.date, amount_cents: l.amount_cents, nature: l.nature }); }` par :
```ts
  for (const l of resolvedLignes) {
    await addLigne(created.id, {
      date_depense: l.date,
      amount_cents: l.amount_cents,
      nature: l.nature,
      type: l.type,
      distance_km_dixiemes: l.distance_km_dixiemes,
      taux_km_millicents: l.taux_km_millicents,
    });
  }
```
(e) Les usages `lignes[0].date` / `lignes[0].nature` (création de l'entête + email) restent valides (`lignes` existe toujours) — ne pas les changer.

- [ ] **Step 6 : Idem dans `update.ts`**

Dans `src/lib/actions/remboursements/update.ts` :
(a) Ajouter `import { getGroupe } from '../../services/groupes';` et ajouter `resolveLignesWithRate` à l'import depuis `./_helpers`.
(b) Après `const lignes = parseLignesFromForm(formData, fail);`, ajouter :
```ts
  const groupe = await getGroupe({ groupId: ctx.groupId });
  const tauxKm = groupe?.taux_km_millicents ?? 354;
  const resolvedLignes = resolveLignesWithRate(lignes, tauxKm);
```
(c) Remplacer la boucle de réinsertion `for (const l of lignes) { await addLigne(id, { date_depense: l.date, amount_cents: l.amount_cents, nature: l.nature }); }` par :
```ts
  for (const l of resolvedLignes) {
    await addLigne(id, {
      date_depense: l.date,
      amount_cents: l.amount_cents,
      nature: l.nature,
      type: l.type,
      distance_km_dixiemes: l.distance_km_dixiemes,
      taux_km_millicents: l.taux_km_millicents,
    });
  }
```

- [ ] **Step 7 : Compilation + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tout passe.

- [ ] **Step 8 : Commit**
```bash
git add web/src/lib/actions/remboursements/_helpers.ts web/src/lib/actions/remboursements/_helpers.test.ts web/src/lib/actions/remboursements/create.ts web/src/lib/actions/remboursements/update.ts
git commit -m "feat(km): parsing type/km + calcul serveur du montant au taux du groupe"
```

---

## Task 4 : Formulaire (sélecteur de type + champ km)

**Files:**
- Modify: `src/components/rembs/remboursement-form.tsx`
- Modify: `src/app/(app)/remboursements/nouveau/page.tsx`
- Modify: `src/app/(app)/remboursements/[id]/edit/page.tsx`

- [ ] **Step 1 : Étendre le formulaire**

Dans `src/components/rembs/remboursement-form.tsx` :

(a) Imports : ajouter `import { computeKmAmountCents, formatKmRate } from '@/lib/services/km';` et `import { NativeSelect } from '@/components/ui/native-select';` (déjà importé). Ajouter `Car` à l'import `lucide-react` (icône). 

(b) Étendre `InitialLigne` et `Ligne` :
```ts
interface InitialLigne {
  date_depense: string;
  amount_cents: number;
  nature: string;
  type?: 'depense' | 'km';
  distance_km_dixiemes?: number | null;
}
interface Ligne {
  key: number;
  type: 'depense' | 'km';
  date: string;
  montant: string; // dépense
  km: string;      // kilométrique (saisie km)
  nature: string;
}
```

(c) Ajouter la prop `tauxKmMillicents: number;` à `Props`, et la recevoir dans la signature de `RemboursementForm`.

(d) Remplacer `newRow` :
```ts
let _rowSeq = 0;
function newRow(today: string, init?: InitialLigne): Ligne {
  if (init) {
    const type = init.type === 'km' ? 'km' : 'depense';
    return {
      key: ++_rowSeq,
      type,
      date: init.date_depense,
      montant: type === 'depense' ? (init.amount_cents / 100).toFixed(2).replace('.', ',') : '',
      km: type === 'km' && init.distance_km_dixiemes != null
        ? (init.distance_km_dixiemes / 10).toString().replace('.', ',')
        : '',
      nature: init.nature,
    };
  }
  return { key: ++_rowSeq, type: 'depense', date: today, montant: '', km: '', nature: '' };
}
```

(e) Remplacer le calcul `total` (lignes ~115-118) par un calcul qui gère les deux types :
```ts
  const ligneAmountCents = (l: Ligne): number => {
    if (l.type === 'km') {
      const km = parseFloat(l.km.replace(',', '.').replace(/\s/g, ''));
      if (!isFinite(km) || km <= 0) return 0;
      return computeKmAmountCents(Math.round(km * 10), tauxKmMillicents);
    }
    const v = parseFloat(l.montant.replace(',', '.').replace(/\s/g, ''));
    return isFinite(v) ? Math.round(v * 100) : 0;
  };
  const totalCents = lignes.reduce((s, l) => s + ligneAmountCents(l), 0);
```
(Remplacer ensuite l'affichage du total `{total.toFixed(2)...}` par `{(totalCents / 100).toFixed(2).replace('.', ',')}&nbsp;€`.)

(f) Ajouter un flag `hasKm` : `const hasKm = lignes.some((l) => l.type === 'km');`.

(g) Dans la `<Section title="Détail des dépenses">`, remplacer la grille de ligne. Pour chaque ligne, ajouter une colonne **Type** (select Dépense/Km) en tête, et selon le type afficher le champ Montant OU le champ Km + montant calculé. Remplacer le bloc `{lignes.map((l, i) => ( ... ))}` par :
```tsx
          {lignes.map((l, i) => (
            <div key={l.key} className="grid grid-cols-[110px_100px_1fr_140px_auto] gap-2 sm:gap-3 items-end">
              <Field label={i === 0 ? 'Type' : ''} htmlFor={`ligne_${i}_type`}>
                <NativeSelect
                  id={`ligne_${i}_type`}
                  value={l.type}
                  onChange={(e) => updateLigne(l.key, { type: e.target.value === 'km' ? 'km' : 'depense' })}
                >
                  <option value="depense">Dépense</option>
                  <option value="km">Kilométrique</option>
                </NativeSelect>
              </Field>
              <input type="hidden" name={`ligne_${i}_type`} value={l.type} />
              <Field label={i === 0 ? 'Date' : ''} htmlFor={`ligne_${i}_date`} required={i === 0}>
                <Input type="date" id={`ligne_${i}_date`} name={`ligne_${i}_date`} required
                  value={l.date} onChange={(e) => updateLigne(l.key, { date: e.target.value })} />
              </Field>
              <Field label={i === 0 ? 'Nature' : ''} htmlFor={`ligne_${i}_nature`} required={i === 0}>
                <Input id={`ligne_${i}_nature`} name={`ligne_${i}_nature`} required
                  placeholder={l.type === 'km' ? 'Ex. trajet domicile → camp' : 'Ex. tickets métro, péage'}
                  value={l.nature} onChange={(e) => updateLigne(l.key, { nature: e.target.value })} />
              </Field>
              {l.type === 'km' ? (
                <Field label={i === 0 ? 'Nb de km' : ''} htmlFor={`ligne_${i}_km`} required={i === 0}>
                  <Input id={`ligne_${i}_km`} name={`ligne_${i}_km`} required inputMode="decimal" placeholder="120"
                    value={l.km} onChange={(e) => updateLigne(l.key, { km: e.target.value })} className="tabular-nums" />
                  <p className="mt-1 text-[11px] text-fg-subtle tabular-nums">
                    = {(ligneAmountCents(l) / 100).toFixed(2).replace('.', ',')} € ({formatKmRate(tauxKmMillicents)}/km)
                  </p>
                </Field>
              ) : (
                <Field label={i === 0 ? 'Montant TTC' : ''} htmlFor={`ligne_${i}_montant`} required={i === 0}>
                  <Input id={`ligne_${i}_montant`} name={`ligne_${i}_montant`} required inputMode="decimal" placeholder="42,50"
                    value={l.montant} onChange={(e) => updateLigne(l.key, { montant: e.target.value })} className="tabular-nums" />
                </Field>
              )}
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeLigne(l.key)}
                disabled={lignes.length === 1} aria-label="Supprimer la ligne"
                className="mb-px text-fg-subtle hover:text-destructive">
                <X size={15} strokeWidth={2} />
              </Button>
            </div>
          ))}
```
(Note : pour une ligne dépense, NE PAS rendre d'input `name="ligne_i_km"` ; pour une ligne km, NE PAS rendre `name="ligne_i_montant"`. Le `parseLignesFromForm` ne lit que le champ pertinent selon `ligne_i_type`.)

(h) Sous la section justificatifs (ou en bas de la section dépenses), afficher le rappel carte grise quand `hasKm` :
```tsx
        {hasKm && (
          <Alert variant="info" className="mt-3">
            <span className="inline-flex items-center gap-1.5">
              <Car size={14} strokeWidth={1.75} />
              Frais kilométriques : pense à joindre la carte grise du véhicule dans les justificatifs.
            </span>
          </Alert>
        )}
```
(Placer ce bloc à l'intérieur de la `<Section title="Justificatifs">`, après le `<FileMultiUploader />`.)

- [ ] **Step 2 : Passer le taux depuis `nouveau/page.tsx`**

Dans `src/app/(app)/remboursements/nouveau/page.tsx` :
- Ajouter `import { getGroupe } from '@/lib/services/groupes';`.
- Récupérer le taux : `const groupe = await getGroupe({ groupId: ctx.groupId });` (à côté des autres `await`).
- Passer `tauxKmMillicents={groupe?.taux_km_millicents ?? 354}` au `<RemboursementForm ... />`.

- [ ] **Step 3 : Passer le taux + pré-remplir type/distance depuis `edit/page.tsx`**

Dans `src/app/(app)/remboursements/[id]/edit/page.tsx` :
- Ajouter `import { getGroupe } from '@/lib/services/groupes';` ; récupérer `const groupe = await getGroupe({ groupId: ctx.groupId });` (le `ctx`/groupId y est déjà disponible).
- Étendre le map `initialLignes` :
```tsx
        initialLignes={lignes.map((l) => ({
          date_depense: l.date_depense,
          amount_cents: l.amount_cents,
          nature: l.nature,
          type: l.type === 'km' ? 'km' : 'depense',
          distance_km_dixiemes: l.distance_km_dixiemes,
        }))}
```
- Passer `tauxKmMillicents={groupe?.taux_km_millicents ?? 354}` au form.

- [ ] **Step 4 : Compilation + lint + tests**

Run: `cd web && npx tsc --noEmit && npx eslint "src/components/rembs/remboursement-form.tsx" && npx vitest run`
Expected: tout passe.

- [ ] **Step 5 : Commit**
```bash
git add web/src/components/rembs/remboursement-form.tsx "web/src/app/(app)/remboursements/nouveau/page.tsx" "web/src/app/(app)/remboursements/[id]/edit/page.tsx"
git commit -m "feat(km): formulaire — type dépense/km par ligne, calcul live, rappel carte grise"
```

---

## Task 5 : Rendu détail + PDF

**Files:**
- Modify: `src/app/(app)/remboursements/[id]/page.tsx`
- Modify: `src/lib/pdf/feuille-remboursement.ts`

- [ ] **Step 1 : Détail — afficher le calcul km**

Dans `src/app/(app)/remboursements/[id]/page.tsx` :
- Ajouter `import { formatKmRate, formatDistance } from '@/lib/services/km';`.
- Dans le `{lignes.map((l) => ( ... ))}` (table), remplacer la cellule Nature pour montrer le détail km sous la nature :
```tsx
                      <td className="py-2 px-2 text-fg">
                        {l.nature}
                        {l.type === 'km' && l.distance_km_dixiemes != null && l.taux_km_millicents != null && (
                          <span className="block text-[11.5px] text-fg-subtle tabular-nums">
                            {formatDistance(l.distance_km_dixiemes)} × {formatKmRate(l.taux_km_millicents)}/km
                          </span>
                        )}
                      </td>
```
(Laisser la cellule Date et la cellule Montant inchangées.)

- [ ] **Step 2 : PDF — détail km inline + rappel taux**

Dans `src/lib/pdf/feuille-remboursement.ts` :
- Ajouter `import { formatKmRate, formatDistance } from '../services/km';`.
- Dans la boucle `for (const l of lignes)`, remplacer la construction de `nature` pour inclure le détail km :
```ts
          let nature = l.notes ? `${l.nature} — ${l.notes}` : l.nature;
          if (l.type === 'km' && l.distance_km_dixiemes != null && l.taux_km_millicents != null) {
            nature += ` (${formatDistance(l.distance_km_dixiemes)} × ${formatKmRate(l.taux_km_millicents)}/km)`;
          }
```
(Le reste de la boucle — `doc.text(nature, ...)` et le montant — reste inchangé ; `amount_cents` porte déjà le montant calculé.)
- Après la ligne « Total » (juste après `y = totalY + 22;`), si au moins une ligne km existe, ajouter un rappel du taux :
```ts
      if (lignes.some((l) => l.type === 'km')) {
        const kmLine = lignes.find((l) => l.type === 'km' && l.taux_km_millicents != null);
        if (kmLine?.taux_km_millicents != null) {
          doc.fillColor('#555').fontSize(8).font('Helvetica')
            .text(`Taux kilométrique appliqué : ${formatKmRate(kmLine.taux_km_millicents)}/km`, 40, y + 4);
          y += 16;
          doc.fillColor('black');
        }
      }
```

- [ ] **Step 3 : Compilation + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tout passe.

- [ ] **Step 4 : Commit**
```bash
git add "web/src/app/(app)/remboursements/[id]/page.tsx" web/src/lib/pdf/feuille-remboursement.ts
git commit -m "feat(km): rendu détail (km × taux) + feuille PDF (détail inline + rappel taux)"
```

---

## Task 6 : Réglage du taux (page admin)

**Files:**
- Create: `src/app/(app)/admin/parametres/page.tsx`
- Create: `src/lib/actions/parametres.ts`
- Modify: `src/components/layout/nav-config.ts`

- [ ] **Step 1 : Action de mise à jour du taux**

Créer `src/lib/actions/parametres.ts` :
```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { requireAdmin } from '../auth/access';
import { updateGroupe } from '../services/groupes';
import { logError } from '../log';

// Met à jour le taux kilométrique du groupe (millièmes d'euro). Saisie en
// euros (« 0,354 ») → millièmes (354). Réservé aux admins.
export async function updateTauxKm(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const raw = ((formData.get('taux_km') as string | null) ?? '').trim().replace(',', '.');
  const euros = Number(raw);
  if (!raw || !isFinite(euros) || euros <= 0) {
    redirect('/admin/parametres?error=' + encodeURIComponent('Taux invalide.'));
  }
  const millicents = Math.round(euros * 1000);

  try {
    await updateGroupe({ groupId: ctx.groupId }, { taux_km_millicents: millicents });
  } catch (err) {
    logError('parametres', 'MAJ taux km échouée', err);
    redirect('/admin/parametres?error=' + encodeURIComponent('Échec de l’enregistrement.'));
  }
  revalidatePath('/admin/parametres');
  redirect('/admin/parametres?saved=1');
}
```
(Le calcul euros → millièmes est fait inline ; pas d'import de `km.ts` ici.)

- [ ] **Step 2 : Page admin**

Créer `src/app/(app)/admin/parametres/page.tsx` :
```tsx
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/shared/section';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/shared/field';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { getGroupe } from '@/lib/services/groupes';
import { updateTauxKm } from '@/lib/actions/parametres';

export const dynamic = 'force-dynamic';

export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);
  const groupe = await getGroupe({ groupId: ctx.groupId });
  const tauxEuros = ((groupe?.taux_km_millicents ?? 354) / 1000).toFixed(3).replace('.', ',');

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Paramètres du groupe" subtitle="Réglages de la compta du groupe." />
      {params.saved && <Alert variant="success" className="mb-6">Taux kilométrique enregistré.</Alert>}
      {params.error && <Alert variant="error" className="mb-6">{params.error}</Alert>}
      <Section title="Frais kilométriques" subtitle="Taux de remboursement au kilomètre (barème SGDF).">
        <form action={updateTauxKm} className="flex items-end gap-3">
          <Field label="Taux (€ / km)" htmlFor="taux_km" required>
            <Input id="taux_km" name="taux_km" required inputMode="decimal" placeholder="0,354"
              defaultValue={tauxEuros} className="tabular-nums w-32" />
          </Field>
          <PendingButton pendingLabel="Enregistrement…">Enregistrer</PendingButton>
        </form>
      </Section>
    </div>
  );
}
```

- [ ] **Step 3 : Entrée de nav**

Dans `src/components/layout/nav-config.ts`, dans le groupe `administration` (items), ajouter une entrée (importer une icône, p.ex. `SlidersHorizontal` de lucide-react) avant ou après « Membres » :
```ts
      { href: '/admin/parametres', label: 'Paramètres', icon: SlidersHorizontal, roles: ADMIN },
```
(Ajouter `SlidersHorizontal` à l'import lucide-react en tête du fichier.)

- [ ] **Step 4 : Compilation + lint + tests**

Run: `cd web && npx tsc --noEmit && npx eslint src/lib/actions/parametres.ts "src/app/(app)/admin/parametres/page.tsx" && npx vitest run`
Expected: tout passe. (Si `nav-config.test.ts` vérifie la liste exacte des items admin, mettre à jour ce test pour inclure `/admin/parametres`.)

- [ ] **Step 5 : Commit**
```bash
git add web/src/lib/actions/parametres.ts "web/src/app/(app)/admin/parametres/page.tsx" web/src/components/layout/nav-config.ts web/src/components/layout/nav-config.test.ts
git commit -m "feat(km): page admin réglage du taux kilométrique"
```

---

## Task 7 : Vérification end-to-end

**Files:** aucun.

- [ ] **Step 1 : Suite complète** — `cd web && npx vitest run` → tout passe.
- [ ] **Step 2 : Build prod** — `cd web && npx next build` → réussi ; `/admin/parametres` listée.
- [ ] **Step 3 : Vérif manuelle (dev, utilisateur)** — `cd web && pnpm dev` :
  - Créer une demande avec une ligne **Dépense** + une ligne **Kilométrique** (ex. 120 km) → le montant km s'affiche (« = 42,48 € »), le total cumule, le rappel carte grise apparaît.
  - Soumettre → détail montre « 120 km × 0,354 €/km » ; le PDF feuille affiche le détail inline + le rappel du taux.
  - Éditer la demande → la ligne km est pré-remplie (type Km, 120). Modifier les km recalcule.
  - `/admin/parametres` (trésorier) → changer le taux à 0,40, créer une nouvelle demande km → nouveau taux appliqué ; l'ancienne demande garde 0,354.
- [ ] **Step 4 : Commit éventuel** des correctifs.

---

## Notes pour l'implémenteur

- **Ne jamais modifier `computeRemboursementHash`** (casserait les signatures existantes). Le montant km est capté via `amount_cents`.
- Le PDF Baloo est mono-colonne montant → le détail km va **inline dans la Nature**, pas dans une colonne dédiée (la fiche officielle SGDF n'est pas reproduite à l'identique).
- Lignes existantes en base → `type='depense'` après migration (rétrocompat ; le formulaire et le parsing traitent l'absence de type comme `depense`).
- Le taux est lu **côté serveur** (jamais reçu du client) et figé sur chaque ligne km à la création/édition.
- Unités : distance en dixièmes de km, taux en millièmes d'euro, montant en centimes. Formule : `round(distance_dixiemes × taux_millicents / 100)`.
