# Export d'archive — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sortir de Baloo un dump technique complet (sécurité) et un dossier d'exercice lisible (passation), avec des contrôles de cohérence utilisables dès maintenant pour préparer la clôture 2025-2026.

**Architecture:** toute la logique (périmètre, contrôles, caviardage, arborescence) vit dans des modules **purs** de `web/src/lib/services/export/`, qui reçoivent un `DbWrapper` en paramètre et ne font aucune I/O disque ni réseau. Les scripts `web/scripts/export-*.ts` portent l'I/O et la progression. Ce découpage rend tout testable en SQLite mémoire et garde la porte ouverte à un `/admin/export` en P3.

**Tech Stack:** TypeScript, Next 16, libSQL/Turso (`DbWrapper` maison), Vitest, `tsx` pour les scripts CLI, `@vercel/blob` pour les fichiers, `pdfkit` (déjà en place, non modifié ici).

**Spec:** [`doc/superpowers/specs/2026-09-21-export-archive-exercice-design.md`](../specs/2026-09-21-export-archive-exercice-design.md) — ADR-040.

## Global Constraints

- **Aucun `DELETE`** sur une table de données utilisateur. Ce chantier est en lecture seule sur la base, à la seule exception de la Task 5 (réécriture de `getClotureReport`, qui ne fait que du `SELECT`).
- **Modules purs sans I/O** dans `lib/services/export/` : pas de `fs`, pas de `fetch`, pas de `getCurrentContext()`. Le `DbWrapper` et le `groupId` sont toujours des **paramètres**, jamais des imports globaux — sinon les scripts CLI ne peuvent pas les utiliser.
- **Montants en centimes** partout en interne (`amount_cents`). Formatage français uniquement à la sortie CSV.
- **Dates ISO** `YYYY-MM-DD`. Bornes d'exercice via `exerciceBounds(code)` de `lib/services/overview.ts` — ne jamais recoder le 01/09 → 31/08.
- **Statuts réels**, à ne pas inventer : écritures `draft | pending_cw | pending_sync | mirror | divergent | supprimee_cw | agrege_remplace` ; remboursements `a_traiter | valide_tresorier | valide_rg | virement_effectue | termine | refuse | converti`. Source : `web/src/lib/types.ts`.
- **FK vides** : tout champ FK passe par `nullIfEmpty` (cf. `web/AGENTS.md`). Ce chantier ne fait pas d'INSERT, mais la règle s'applique si un helper est touché.
- **Tests** : Vitest, fixtures SQLite en mémoire via `createClient({ url: 'file::memory:' })` + `wrapClient`, avec `PRAGMA foreign_keys = OFF`. Pattern de référence : `web/src/lib/services/__tests__/depots-detach.test.ts`.
- **Commandes** : `cd web && pnpm vitest run <path>` pour un fichier, `pnpm lint` avant chaque commit.
- **Commits** en français, présent de l'indicatif, atomiques (cf. `doc/DEVELOPING.md`).

## Phasage

| Phase | Tasks | Livre |
|---|---|---|
| **1 — Contrôles** | 1 → 5 | `pnpm export:controles` : la liste de ce qui manque avant clôture. **Utilisable immédiatement.** |
| **2 — Dump technique** | 6 → 9 | `pnpm export:dump` : le filet de sécurité. |
| **3 — Dossier d'exercice** | 10 → 14 | `pnpm export:exercice` : l'archive Drive. |

Chaque phase est autonome : on peut s'arrêter après la 1 et avoir gagné quelque chose.

## File Structure

| Fichier | Responsabilité |
|---|---|
| `web/src/lib/services/export/bornes.ts` | Bornes temporelles d'un exercice par entité (écriture, remb, abandon, caisse). Pur. |
| `web/src/lib/services/export/controles.ts` | Les 6 contrôles de cohérence, renvoyant des **listes**. Pur, prend `(db, groupId, bornes)`. |
| `web/src/lib/services/export/tables.ts` | Classification de chaque table du schéma : incluse (avec régime de sélection) ou exclue. Pur, pas de SQL. |
| `web/src/lib/services/export/caviardage.ts` | Retrait des champs sensibles d'une ligne. Pur. |
| `web/src/lib/services/export/collecte.ts` | Lecture des tables selon leur régime → lignes JSON. Prend `db`. |
| `web/src/lib/services/export/arborescence.ts` | Construction des noms de dossiers/fichiers sûrs. Pur, pas de `fs`. |
| `web/src/lib/csv.ts` | Formateur CSV partagé, extrait de la route d'export existante. |
| `web/scripts/export-controles.ts` | CLI : affiche les contrôles. I/O seulement. |
| `web/scripts/export-dump.ts` | CLI : écrit le dump. I/O seulement. |
| `web/scripts/export-exercice.ts` | CLI : écrit le dossier d'exercice. I/O seulement. |

---

# Phase 1 — Contrôles de cohérence

### Task 1: Bornes temporelles par entité

**Files:**
- Create: `web/src/lib/services/export/bornes.ts`
- Test: `web/src/lib/services/export/__tests__/bornes.test.ts`

**Interfaces:**
- Consumes: `exerciceBounds(exercice: string): { start: string; end: string }` depuis `web/src/lib/services/overview.ts`.
- Produces: `interface BornesExercice { exercice: string; debut: string; fin: string; finInclusiveTs: string }` et `bornesPourExercice(exercice: string): BornesExercice`.

`finInclusiveTs` vaut `${fin}T23:59:59Z` : les remboursements sont bornés sur `COALESCE(date_depense, created_at)`, et `created_at` est un timestamp complet. Comparer un timestamp à une date nue exclurait à tort tout ce qui a été créé le dernier jour de l'exercice.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/lib/services/export/__tests__/bornes.test.ts
import { describe, it, expect } from 'vitest';
import { bornesPourExercice } from '../bornes';

describe('bornesPourExercice', () => {
  it('borne un exercice SGDF du 01/09 au 31/08', () => {
    expect(bornesPourExercice('2025-2026')).toEqual({
      exercice: '2025-2026',
      debut: '2025-09-01',
      fin: '2026-08-31',
      finInclusiveTs: '2026-08-31T23:59:59Z',
    });
  });

  it('refuse un code d’exercice malformé', () => {
    expect(() => bornesPourExercice('2025')).toThrow(/Exercice invalide/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/bornes.test.ts`
Expected: FAIL — « Failed to resolve import "../bornes" ».

- [ ] **Step 3: Write minimal implementation**

```typescript
// web/src/lib/services/export/bornes.ts
// Bornes temporelles d'un exercice, prêtes à être passées aux requêtes
// d'export. Module pur : aucune I/O, aucune BDD.
import { exerciceBounds } from '../overview';

export interface BornesExercice {
  exercice: string;
  debut: string; // ISO 'YYYY-MM-DD', inclus
  fin: string; // ISO 'YYYY-MM-DD', inclus
  // Les remboursements sont bornés sur COALESCE(date_depense, created_at),
  // et created_at est un timestamp complet : comparer à la date nue
  // exclurait tout ce qui a été créé le dernier jour de l'exercice.
  finInclusiveTs: string;
}

export function bornesPourExercice(exercice: string): BornesExercice {
  const { start, end } = exerciceBounds(exercice);
  return { exercice, debut: start, fin: end, finInclusiveTs: `${end}T23:59:59Z` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/bornes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd web && pnpm lint
git add src/lib/services/export/bornes.ts src/lib/services/export/__tests__/bornes.test.ts
git commit -m "export: bornes temporelles d'un exercice"
```

---

### Task 2: Contrôles — écritures sans justificatif et remboursements sans PDF

**Files:**
- Create: `web/src/lib/services/export/controles.ts`
- Test: `web/src/lib/services/export/__tests__/controles.test.ts`

**Interfaces:**
- Consumes: `BornesExercice` (Task 1) ; `DbWrapper` depuis `web/src/lib/db.ts`.
- Produces:

```typescript
export interface LigneControle {
  id: string;
  date: string | null;
  libelle: string;
  montantCents: number;
  detail: string | null;
}
export interface Controle {
  cle: 'ecriture_sans_justif' | 'remb_sans_pdf' | 'depot_orphelin'
     | 'blob_manquant' | 'ecart_miroir' | 'ecriture_divergente';
  titre: string;
  lignes: LigneControle[];
}
export async function controleEcrituresSansJustif(
  db: DbWrapper, groupId: string, bornes: BornesExercice): Promise<Controle>;
export async function controleRembsSansPdf(
  db: DbWrapper, groupId: string, bornes: BornesExercice): Promise<Controle>;
```

Les tâches 3 et 4 ajoutent les quatre autres contrôles dans ce même fichier, avec la même signature `(db, groupId, bornes) => Promise<Controle>`.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/lib/services/export/__tests__/controles.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';
import { bornesPourExercice } from '../bornes';
import { controleEcrituresSansJustif, controleRembsSansPdf } from '../controles';

const BORNES = bornesPourExercice('2025-2026');
let db: DbWrapper;

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const d = wrapClient(client);
  await d.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, justif_attendu INTEGER DEFAULT 0, status TEXT
    );
    CREATE TABLE justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, file_path TEXT, original_filename TEXT,
      entity_type TEXT, entity_id TEXT, obsolete_at TEXT
    );
    CREATE TABLE remboursements (
      id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, total_cents INTEGER,
      date_depense TEXT, created_at TEXT, status TEXT
    );
  `);
  return d;
}

async function insertEcriture(
  o: { id: string; date?: string; justif?: number; type?: string },
) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, justif_attendu, status)
       VALUES (?, 'g', ?, 'Intermarché', 8777, ?, ?, 'mirror')`,
    )
    .run(o.id, o.date ?? '2026-08-05', o.type ?? 'depense', o.justif ?? 1);
}

async function insertJustif(o: { id: string; entity: string; obsolete?: string | null }) {
  await db
    .prepare(
      `INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id, obsolete_at)
       VALUES (?, 'g', 'blob/x.jpg', 'x.jpg', 'ecriture', ?, ?)`,
    )
    .run(o.id, o.entity, o.obsolete ?? null);
}

beforeEach(async () => {
  db = await setup();
});

describe('controleEcrituresSansJustif', () => {
  it('signale une dépense attendant un justif qui n’en a aucun', async () => {
    await insertEcriture({ id: 'ECR-1' });
    const r = await controleEcrituresSansJustif(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['ECR-1']);
  });

  it('ne signale pas une dépense qui a un justif vivant', async () => {
    await insertEcriture({ id: 'ECR-1' });
    await insertJustif({ id: 'JUS-1', entity: 'ECR-1' });
    const r = await controleEcrituresSansJustif(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });

  it('signale une dépense dont le seul justif est obsolète', async () => {
    // Écart corrigé vs queries/cloture.ts, qui ne filtre pas obsolete_at :
    // un justif remplacé y compte encore comme une pièce présente.
    await insertEcriture({ id: 'ECR-1' });
    await insertJustif({ id: 'JUS-1', entity: 'ECR-1', obsolete: '2026-08-10T00:00:00Z' });
    const r = await controleEcrituresSansJustif(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['ECR-1']);
  });

  it('ignore les recettes et les écritures hors exercice', async () => {
    await insertEcriture({ id: 'ECR-RECETTE', type: 'recette' });
    await insertEcriture({ id: 'ECR-HORS', date: '2026-09-01' });
    await insertEcriture({ id: 'ECR-LIMITE', date: '2026-08-31' });
    const r = await controleEcrituresSansJustif(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['ECR-LIMITE']);
  });

  it('ignore un autre groupe', async () => {
    await insertEcriture({ id: 'ECR-1' });
    const r = await controleEcrituresSansJustif(db, 'autre', BORNES);
    expect(r.lignes).toEqual([]);
  });
});

describe('controleRembsSansPdf', () => {
  async function insertRemb(o: { id: string; status: string; date?: string }) {
    await db
      .prepare(
        `INSERT INTO remboursements (id, group_id, demandeur, total_cents, date_depense, created_at, status)
         VALUES (?, 'g', 'Pierre', 4200, ?, '2026-07-01T00:00:00Z', ?)`,
      )
      .run(o.id, o.date ?? '2026-07-01', o.status);
  }

  it('signale un remboursement abouti sans feuille PDF', async () => {
    await insertRemb({ id: 'REMB-1', status: 'termine' });
    await insertRemb({ id: 'REMB-2', status: 'virement_effectue' });
    const r = await controleRembsSansPdf(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id).sort()).toEqual(['REMB-1', 'REMB-2']);
  });

  it('ne signale pas un remboursement qui a sa feuille', async () => {
    await insertRemb({ id: 'REMB-1', status: 'termine' });
    await db
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id, obsolete_at)
         VALUES ('JUS-F', 'g', 'blob/f.pdf', 'feuille.pdf', 'remboursement_feuille', 'REMB-1', NULL)`,
      )
      .run();
    const r = await controleRembsSansPdf(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });

  it('ne signale pas une demande encore en cours ou refusée', async () => {
    await insertRemb({ id: 'REMB-A', status: 'a_traiter' });
    await insertRemb({ id: 'REMB-R', status: 'refuse' });
    const r = await controleRembsSansPdf(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });

  it('borne sur created_at quand date_depense est absente', async () => {
    await db
      .prepare(
        `INSERT INTO remboursements (id, group_id, demandeur, total_cents, date_depense, created_at, status)
         VALUES ('REMB-N', 'g', 'Pierre', 4200, NULL, '2026-08-31T18:00:00Z', 'termine')`,
      )
      .run();
    const r = await controleRembsSansPdf(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['REMB-N']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/controles.test.ts`
Expected: FAIL — « Failed to resolve import "../controles" ».

- [ ] **Step 3: Write minimal implementation**

```typescript
// web/src/lib/services/export/controles.ts
// Contrôles de cohérence d'un exercice : ils renvoient des LISTES, pas des
// compteurs — l'export doit pouvoir nommer ce qui manque. Aucun contrôle ne
// bloque l'export : ils décrivent.
//
// `db` et `groupId` sont des paramètres, jamais des imports globaux : ces
// fonctions tournent aussi bien depuis un script CLI (pas de session HTTP)
// que depuis une server action.
import type { DbWrapper } from '../../db';
import type { BornesExercice } from './bornes';

export interface LigneControle {
  id: string;
  date: string | null;
  libelle: string;
  montantCents: number;
  detail: string | null;
}

export interface Controle {
  cle:
    | 'ecriture_sans_justif'
    | 'remb_sans_pdf'
    | 'depot_orphelin'
    | 'blob_manquant'
    | 'ecart_miroir'
    | 'ecriture_divergente';
  titre: string;
  lignes: LigneControle[];
}

export async function controleEcrituresSansJustif(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
): Promise<Controle> {
  const rows = await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents
         FROM ecritures e
        WHERE e.group_id = ?
          AND e.type = 'depense'
          AND e.justif_attendu = 1
          AND e.date_ecriture >= ?
          AND e.date_ecriture <= ?
          AND NOT EXISTS (
            SELECT 1 FROM justificatifs j
             WHERE j.entity_type = 'ecriture'
               AND j.entity_id = e.id
               AND j.obsolete_at IS NULL
          )
        ORDER BY e.date_ecriture, e.id`,
    )
    .all<{ id: string; date_ecriture: string | null; description: string | null; amount_cents: number }>(
      groupId,
      bornes.debut,
      bornes.fin,
    );

  return {
    cle: 'ecriture_sans_justif',
    titre: 'Écritures sans justificatif',
    lignes: rows.map((r) => ({
      id: r.id,
      date: r.date_ecriture,
      libelle: r.description ?? '',
      montantCents: r.amount_cents,
      detail: null,
    })),
  };
}

export async function controleRembsSansPdf(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
): Promise<Controle> {
  const rows = await db
    .prepare(
      `SELECT r.id, r.date_depense, r.created_at, r.demandeur, r.total_cents, r.status
         FROM remboursements r
        WHERE r.group_id = ?
          AND r.status IN ('virement_effectue', 'termine')
          AND COALESCE(r.date_depense, r.created_at) >= ?
          AND COALESCE(r.date_depense, r.created_at) <= ?
          AND NOT EXISTS (
            SELECT 1 FROM justificatifs j
             WHERE j.entity_type = 'remboursement_feuille'
               AND j.entity_id = r.id
               AND j.obsolete_at IS NULL
          )
        ORDER BY COALESCE(r.date_depense, r.created_at), r.id`,
    )
    .all<{
      id: string;
      date_depense: string | null;
      created_at: string | null;
      demandeur: string | null;
      total_cents: number;
      status: string;
    }>(groupId, bornes.debut, bornes.finInclusiveTs);

  return {
    cle: 'remb_sans_pdf',
    titre: 'Remboursements aboutis sans feuille signée',
    lignes: rows.map((r) => ({
      id: r.id,
      date: r.date_depense ?? (r.created_at ? r.created_at.slice(0, 10) : null),
      libelle: r.demandeur ?? '',
      montantCents: r.total_cents,
      detail: `statut ${r.status}`,
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/controles.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
cd web && pnpm lint
git add src/lib/services/export/controles.ts src/lib/services/export/__tests__/controles.test.ts
git commit -m "export: contrôles écritures sans justif et rembs sans feuille"
```

---

### Task 3: Contrôles — dépôts orphelins et écarts de miroir

**Files:**
- Modify: `web/src/lib/services/export/controles.ts` (ajout de deux fonctions à la fin)
- Modify: `web/src/lib/services/export/__tests__/controles.test.ts` (ajout de deux `describe`)

**Interfaces:**
- Consumes: `Controle`, `LigneControle`, `BornesExercice` (Tasks 1-2).
- Produces:

```typescript
export async function controleDepotsOrphelins(
  db: DbWrapper, groupId: string, bornes: BornesExercice): Promise<Controle>;
export async function controleEcartsMiroir(
  db: DbWrapper, groupId: string, bornes: BornesExercice): Promise<Controle[]>;
```

`controleEcartsMiroir` renvoie **deux** `Controle` : `ecart_miroir` (tout ce qui n'est pas `mirror`, une ligne par écriture) et `ecriture_divergente` (le sous-ensemble `divergent`, qui mérite d'être vu séparément parce qu'il signifie « Baloo et Comptaweb ne disent pas la même chose », pas « pas encore envoyé »).

Les statuts `supprimee_cw` et `agrege_remplace` sont **exclus** : ce sont des états terminaux normaux du miroir (écriture supprimée côté CW, agrégat DSP2 remplacé par ses sous-lignes), pas des écarts à corriger.

- [ ] **Step 1: Write the failing test**

Ajouter à la fin de `web/src/lib/services/export/__tests__/controles.test.ts` :

```typescript
describe('controleDepotsOrphelins', () => {
  beforeEach(async () => {
    await db.exec(`
      CREATE TABLE depots_justificatifs (
        id TEXT PRIMARY KEY, group_id TEXT, titre TEXT, amount_cents INTEGER,
        date_estimee TEXT, statut TEXT, ecriture_id TEXT, remboursement_id TEXT,
        created_at TEXT
      );
    `);
  });

  async function insertDepot(o: {
    id: string;
    statut?: string;
    ecriture?: string | null;
    remb?: string | null;
    date?: string;
  }) {
    await db
      .prepare(
        `INSERT INTO depots_justificatifs
           (id, group_id, titre, amount_cents, date_estimee, statut, ecriture_id, remboursement_id, created_at)
         VALUES (?, 'g', 'Ticket Vival', 1059, ?, ?, ?, ?, '2026-08-06T10:00:00Z')`,
      )
      .run(o.id, o.date ?? '2026-08-06', o.statut ?? 'a_traiter', o.ecriture ?? null, o.remb ?? null);
  }

  it('signale un dépôt rattaché à rien', async () => {
    await insertDepot({ id: 'DEP-1' });
    const r = await controleDepotsOrphelins(db, 'g', BORNES);
    expect(r.lignes.map((l) => l.id)).toEqual(['DEP-1']);
  });

  it('ne signale pas un dépôt rattaché à une écriture ou à un remboursement', async () => {
    await insertDepot({ id: 'DEP-E', ecriture: 'ECR-1' });
    await insertDepot({ id: 'DEP-R', remb: 'REMB-1' });
    const r = await controleDepotsOrphelins(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });

  it('ne signale pas un dépôt rejeté', async () => {
    await insertDepot({ id: 'DEP-X', statut: 'rejete' });
    const r = await controleDepotsOrphelins(db, 'g', BORNES);
    expect(r.lignes).toEqual([]);
  });
});

describe('controleEcartsMiroir', () => {
  async function insertAvecStatut(id: string, status: string) {
    await db
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, justif_attendu, status)
         VALUES (?, 'g', '2026-08-05', 'Essence', 6500, 'depense', 0, ?)`,
      )
      .run(id, status);
  }

  it('sépare les écarts de miroir des vraies divergences', async () => {
    await insertAvecStatut('ECR-D', 'draft');
    await insertAvecStatut('ECR-P', 'pending_sync');
    await insertAvecStatut('ECR-V', 'divergent');
    await insertAvecStatut('ECR-M', 'mirror');
    const [ecarts, divergentes] = await controleEcartsMiroir(db, 'g', BORNES);
    expect(ecarts.cle).toBe('ecart_miroir');
    expect(ecarts.lignes.map((l) => l.id).sort()).toEqual(['ECR-D', 'ECR-P', 'ECR-V']);
    expect(divergentes.cle).toBe('ecriture_divergente');
    expect(divergentes.lignes.map((l) => l.id)).toEqual(['ECR-V']);
  });

  it('ne compte pas les états terminaux normaux du miroir', async () => {
    await insertAvecStatut('ECR-S', 'supprimee_cw');
    await insertAvecStatut('ECR-A', 'agrege_remplace');
    const [ecarts] = await controleEcartsMiroir(db, 'g', BORNES);
    expect(ecarts.lignes).toEqual([]);
  });

  it('porte le statut dans le détail de chaque ligne', async () => {
    await insertAvecStatut('ECR-D', 'draft');
    const [ecarts] = await controleEcartsMiroir(db, 'g', BORNES);
    expect(ecarts.lignes[0].detail).toBe('statut draft');
  });
});
```

Ajouter les imports en tête du fichier :

```typescript
import {
  controleEcrituresSansJustif,
  controleRembsSansPdf,
  controleDepotsOrphelins,
  controleEcartsMiroir,
} from '../controles';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/controles.test.ts`
Expected: FAIL — « controleDepotsOrphelins is not a function » (ou erreur d'import).

- [ ] **Step 3: Write minimal implementation**

Ajouter à la fin de `web/src/lib/services/export/controles.ts` :

```typescript
export async function controleDepotsOrphelins(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
): Promise<Controle> {
  const rows = await db
    .prepare(
      `SELECT id, titre, amount_cents, date_estimee, created_at, statut
         FROM depots_justificatifs
        WHERE group_id = ?
          AND ecriture_id IS NULL
          AND remboursement_id IS NULL
          AND statut <> 'rejete'
          AND COALESCE(date_estimee, created_at) >= ?
          AND COALESCE(date_estimee, created_at) <= ?
        ORDER BY COALESCE(date_estimee, created_at), id`,
    )
    .all<{
      id: string;
      titre: string | null;
      amount_cents: number | null;
      date_estimee: string | null;
      created_at: string | null;
      statut: string;
    }>(groupId, bornes.debut, bornes.finInclusiveTs);

  return {
    cle: 'depot_orphelin',
    titre: 'Dépôts rattachés à rien',
    lignes: rows.map((r) => ({
      id: r.id,
      date: r.date_estimee ?? (r.created_at ? r.created_at.slice(0, 10) : null),
      libelle: r.titre ?? '',
      montantCents: r.amount_cents ?? 0,
      detail: `statut ${r.statut}`,
    })),
  };
}

// Les écritures `supprimee_cw` et `agrege_remplace` sont des états terminaux
// normaux du miroir (supprimée côté CW, agrégat DSP2 remplacé par ses
// sous-lignes) : ce ne sont pas des écarts à corriger.
const STATUTS_TERMINAUX = ['mirror', 'supprimee_cw', 'agrege_remplace'];

export async function controleEcartsMiroir(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
): Promise<Controle[]> {
  const placeholders = STATUTS_TERMINAUX.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT id, date_ecriture, description, amount_cents, status
         FROM ecritures
        WHERE group_id = ?
          AND date_ecriture >= ?
          AND date_ecriture <= ?
          AND status NOT IN (${placeholders})
        ORDER BY date_ecriture, id`,
    )
    .all<{
      id: string;
      date_ecriture: string | null;
      description: string | null;
      amount_cents: number;
      status: string;
    }>(groupId, bornes.debut, bornes.fin, ...STATUTS_TERMINAUX);

  const lignes: LigneControle[] = rows.map((r) => ({
    id: r.id,
    date: r.date_ecriture,
    libelle: r.description ?? '',
    montantCents: r.amount_cents,
    detail: `statut ${r.status}`,
  }));

  return [
    {
      cle: 'ecart_miroir',
      titre: 'Écritures non matérialisées dans Comptaweb',
      lignes,
    },
    {
      cle: 'ecriture_divergente',
      titre: 'Écritures divergentes (Baloo ≠ Comptaweb)',
      lignes: rows
        .filter((r) => r.status === 'divergent')
        .map((r) => ({
          id: r.id,
          date: r.date_ecriture,
          libelle: r.description ?? '',
          montantCents: r.amount_cents,
          detail: 'divergent',
        })),
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/controles.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
cd web && pnpm lint
git add src/lib/services/export/controles.ts src/lib/services/export/__tests__/controles.test.ts
git commit -m "export: contrôles dépôts orphelins et écarts de miroir"
```

---

### Task 4: Agrégateur `rapportControles` + script CLI

**Files:**
- Modify: `web/src/lib/services/export/controles.ts`
- Modify: `web/src/lib/services/export/__tests__/controles.test.ts`
- Create: `web/scripts/export-controles.ts`
- Modify: `web/package.json` (ajout du script `export:controles`)

**Interfaces:**
- Consumes: les quatre fonctions de contrôle (Tasks 2-3), `bornesPourExercice` (Task 1), `getCliContext(): Promise<{ userId, groupId, email }>` depuis `web/scripts/cli-context.ts`, `getDb()` depuis `web/src/lib/db.ts`.
- Produces: `rapportControles(db: DbWrapper, groupId: string, bornes: BornesExercice): Promise<Controle[]>` et `formatRapportTexte(controles: Controle[], bornes: BornesExercice): string`.

Le contrôle `blob_manquant` n'est **pas** dans `rapportControles` : c'est le seul qui exige de la I/O réseau. Il est ajouté en Task 9, après le dump.

- [ ] **Step 1: Write the failing test**

Ajouter à `web/src/lib/services/export/__tests__/controles.test.ts` :

```typescript
describe('rapportControles', () => {
  it('renvoie les cinq contrôles hors I/O, dans un ordre stable', async () => {
    await db.exec(`
      CREATE TABLE depots_justificatifs (
        id TEXT PRIMARY KEY, group_id TEXT, titre TEXT, amount_cents INTEGER,
        date_estimee TEXT, statut TEXT, ecriture_id TEXT, remboursement_id TEXT,
        created_at TEXT
      );
    `);
    const r = await rapportControles(db, 'g', BORNES);
    expect(r.map((c) => c.cle)).toEqual([
      'ecriture_sans_justif',
      'remb_sans_pdf',
      'depot_orphelin',
      'ecart_miroir',
      'ecriture_divergente',
    ]);
  });
});

describe('formatRapportTexte', () => {
  it('annonce le sans-faute quand rien n’est signalé', () => {
    const texte = formatRapportTexte(
      [{ cle: 'depot_orphelin', titre: 'Dépôts rattachés à rien', lignes: [] }],
      BORNES,
    );
    expect(texte).toContain('2025-2026');
    expect(texte).toContain('Rien à signaler');
  });

  it('liste chaque ligne avec son montant en format français', () => {
    const texte = formatRapportTexte(
      [
        {
          cle: 'ecriture_sans_justif',
          titre: 'Écritures sans justificatif',
          lignes: [
            { id: 'ECR-1', date: '2026-08-05', libelle: 'Intermarché', montantCents: 8777, detail: null },
          ],
        },
      ],
      BORNES,
    );
    expect(texte).toContain('Écritures sans justificatif (1)');
    expect(texte).toContain('ECR-1');
    expect(texte).toContain('87,77 €');
  });
});
```

Compléter l'import en tête du fichier avec `rapportControles` et `formatRapportTexte`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/controles.test.ts`
Expected: FAIL — « rapportControles is not a function ».

- [ ] **Step 3: Write minimal implementation**

Ajouter à `web/src/lib/services/export/controles.ts` :

```typescript
/**
 * Tous les contrôles réalisables sans I/O, dans un ordre stable (celui de
 * lecture du rapport). Le contrôle `blob_manquant` n'est pas ici : il exige
 * d'interroger le store de fichiers, et vit donc côté script.
 */
export async function rapportControles(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
): Promise<Controle[]> {
  const [sansJustif, sansPdf, orphelins, miroir] = await Promise.all([
    controleEcrituresSansJustif(db, groupId, bornes),
    controleRembsSansPdf(db, groupId, bornes),
    controleDepotsOrphelins(db, groupId, bornes),
    controleEcartsMiroir(db, groupId, bornes),
  ]);
  return [sansJustif, sansPdf, orphelins, ...miroir];
}

function montantFr(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')} €`;
}

/** Rendu texte du rapport, réutilisé tel quel en tête du README.md du dossier. */
export function formatRapportTexte(controles: Controle[], bornes: BornesExercice): string {
  const out: string[] = [`Contrôles de cohérence — exercice ${bornes.exercice} (${bornes.debut} → ${bornes.fin})`, ''];
  let total = 0;
  for (const c of controles) {
    total += c.lignes.length;
    if (c.lignes.length === 0) {
      out.push(`✅ ${c.titre} : rien à signaler`);
      continue;
    }
    out.push(`⚠️  ${c.titre} (${c.lignes.length})`);
    for (const l of c.lignes) {
      const detail = l.detail ? ` — ${l.detail}` : '';
      out.push(`     ${l.date ?? '?'}  ${l.id}  ${montantFr(l.montantCents)}  ${l.libelle}${detail}`);
    }
    out.push('');
  }
  if (total === 0) out.push('', 'Rien à signaler : l’exercice est prêt à être clos.');
  return out.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/controles.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Write the CLI script**

```typescript
// web/scripts/export-controles.ts
// Contrôles de cohérence d'un exercice, en lecture seule.
//
//   pnpm export:controles              -> exercice courant
//   pnpm export:controles 2025-2026    -> exercice explicite
//
// À lancer AVANT de déclarer un exercice clos : le rapport dit ce qui manque
// pendant qu'il est encore temps de le corriger.
import { getDb } from '../src/lib/db';
import { currentExercice } from '../src/lib/services/overview';
import { bornesPourExercice } from '../src/lib/services/export/bornes';
import { rapportControles, formatRapportTexte } from '../src/lib/services/export/controles';
import { getCliContext } from './cli-context';

async function main() {
  const exercice = process.argv[2] ?? currentExercice();
  const bornes = bornesPourExercice(exercice);
  const { groupId } = await getCliContext();
  const controles = await rapportControles(getDb(), groupId, bornes);
  console.log(formatRapportTexte(controles, bornes));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Ajouter dans `web/package.json`, section `scripts` :

```json
"export:controles": "tsx scripts/export-controles.ts"
```

- [ ] **Step 6: Run the script against the real database**

Run: `cd web && pnpm export:controles 2025-2026`
Expected: un rapport lisible, sans exception. C'est le premier livrable utilisable du chantier — lire la sortie et vérifier qu'elle a du sens face à ce qu'on sait de l'exercice (les 3 todos de camp ouvertes doivent s'y retrouver).

- [ ] **Step 7: Commit**

```bash
cd web && pnpm lint
git add src/lib/services/export/controles.ts src/lib/services/export/__tests__/controles.test.ts scripts/export-controles.ts package.json
git commit -m "export: rapport de contrôles et script CLI"
```

---

### Task 5: Rebaser `/cloture` sur les contrôles partagés

**Files:**
- Modify: `web/src/lib/queries/cloture.ts:50-103` (les quatre requêtes de comptage)
- Test: `web/src/lib/queries/__tests__/cloture.test.ts` (créer si absent)

**Interfaces:**
- Consumes: `controleEcrituresSansJustif`, `controleDepotsOrphelins` (Tasks 2-3) ; `BornesExercice` (Task 1).
- Produces: `getClotureReport` inchangé en signature et en type de retour (`ClotureReport`). Seule l'implémentation change.

**Pourquoi cette tâche existe** : sans elle, « écriture sans justif » a deux définitions SQL dans le repo, qui divergeront. C'est exactement le grief de l'issue #23. La page `/cloture` raisonne par **mois**, les contrôles par **exercice** : les fonctions de contrôle prennent des bornes en paramètre, donc un mois est une borne comme une autre.

**Effet de bord attendu et voulu** : les compteurs de `/cloture` peuvent augmenter, parce que la requête actuelle ne filtre pas `obsolete_at` — une écriture dont l'unique justif a été remplacé y compte comme justifiée. C'est une correction.

Les deux autres blockers (`remb_non_termine`, `abandon_non_termine`) ne correspondent à aucun contrôle d'export (ils visent les demandes **en cours**, pas les demandes abouties sans PDF) : ils restent en place, inchangés.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/lib/queries/__tests__/cloture.test.ts
// Non-régression de la bascule des blockers de /cloture sur les contrôles
// partagés de l'export (Task 5). Le point vérifié : un justif OBSOLÈTE ne
// compte plus comme une pièce présente.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../context', () => ({
  getCurrentContext: async () => ({ groupId: 'g', userId: 'u', role: 'tresorier' }),
}));
vi.mock('../../services/depots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/depots')>();
  return { ...actual, ensureDepotsSchema: async () => {} };
});

import { getClotureReport } from '../cloture';

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(client);
  await testDb.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, justif_attendu INTEGER DEFAULT 0, status TEXT
    );
    CREATE TABLE justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, file_path TEXT, original_filename TEXT,
      entity_type TEXT, entity_id TEXT, obsolete_at TEXT
    );
    CREATE TABLE depots_justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, titre TEXT, amount_cents INTEGER,
      date_estimee TEXT, statut TEXT, ecriture_id TEXT, remboursement_id TEXT,
      created_at TEXT
    );
    CREATE TABLE remboursements (
      id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, total_cents INTEGER,
      date_depense TEXT, created_at TEXT, status TEXT
    );
    CREATE TABLE abandons_frais (
      id TEXT PRIMARY KEY, group_id TEXT, date_depense TEXT, status TEXT
    );
  `);
});

function countOf(report: Awaited<ReturnType<typeof getClotureReport>>, kind: string) {
  return report.blockers.find((b) => b.kind === kind)!.count;
}

describe('getClotureReport', () => {
  it('compte une écriture dont le seul justif est obsolète comme non justifiée', async () => {
    await testDb
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, justif_attendu, status)
         VALUES ('ECR-1', 'g', '2026-08-05', 'Intermarché', 8777, 'depense', 1, 'mirror')`,
      )
      .run();
    await testDb
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id, obsolete_at)
         VALUES ('JUS-1', 'g', 'blob/x.jpg', 'x.jpg', 'ecriture', 'ECR-1', '2026-08-10T00:00:00Z')`,
      )
      .run();
    const report = await getClotureReport(2026, 8);
    expect(countOf(report, 'ecriture_sans_justif')).toBe(1);
  });

  it('borne le comptage au mois demandé', async () => {
    await testDb
      .prepare(
        `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, justif_attendu, status)
         VALUES ('ECR-JUIL', 'g', '2026-07-31', 'Essence', 6500, 'depense', 1, 'mirror')`,
      )
      .run();
    const report = await getClotureReport(2026, 8);
    expect(countOf(report, 'ecriture_sans_justif')).toBe(0);
  });

  it('compte les dépôts rattachés à rien du mois', async () => {
    await testDb
      .prepare(
        `INSERT INTO depots_justificatifs
           (id, group_id, titre, amount_cents, date_estimee, statut, ecriture_id, remboursement_id, created_at)
         VALUES ('DEP-1', 'g', 'Vival', 1059, '2026-08-06', 'a_traiter', NULL, NULL, '2026-08-06T10:00:00Z')`,
      )
      .run();
    const report = await getClotureReport(2026, 8);
    expect(countOf(report, 'justif_orphelin')).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/queries/__tests__/cloture.test.ts`
Expected: FAIL sur le premier test — `expected 0 to be 1`, parce que la requête actuelle ignore `obsolete_at`.

- [ ] **Step 3: Rewrite the two queries on top of the shared controls**

Dans `web/src/lib/queries/cloture.ts`, remplacer les deux premières entrées du `Promise.all` (les requêtes `ecrSansJustif` et `justifsOrphelins`) par un appel aux contrôles partagés, en gardant les deux autres telles quelles :

```typescript
import { controleEcrituresSansJustif, controleDepotsOrphelins } from '../services/export/controles';
import type { BornesExercice } from '../services/export/bornes';

// … dans getClotureReport, après le calcul de startDate / endDate :

// Un mois est une borne comme une autre : les contrôles de l'export prennent
// leurs bornes en paramètre, donc la même règle métier sert ici et là.
// Sans ça, "écriture sans justif" aurait deux définitions SQL divergeables.
const bornesMois: BornesExercice = {
  exercice: `${year}-${pad2(month)}`,
  debut: startDate,
  fin: endDate,
  finInclusiveTs: `${endDate}T23:59:59Z`,
};

const [ecrSansJustif, depotsOrphelins, rembsNonTermine, abandonsNonTermine] =
  await Promise.all([
    controleEcrituresSansJustif(db, groupId, bornesMois),
    controleDepotsOrphelins(db, groupId, bornesMois),
    // … les deux requêtes existantes, inchangées
  ]);
```

Puis, dans la construction du tableau `blockers`, remplacer les deux comptages correspondants :

```typescript
{
  kind: 'ecriture_sans_justif',
  count: ecrSansJustif.lignes.length,
  href: '/inbox?period=tout',
  label: 'écriture(s) sans justif',
  hint: 'Lie un justif depuis l’inbox, ou marque "Pas de justif attendu".',
},
{
  kind: 'justif_orphelin',
  count: depotsOrphelins.lignes.length,
  href: '/inbox?period=tout',
  label: 'justif(s) orphelin(s)',
  hint: 'Rattache à une écriture ou rejette depuis l’inbox.',
},
```

Note : le blocker `justif_orphelin` change légèrement de définition. L'ancienne requête comptait les dépôts `statut = 'a_traiter'` créés avant la fin du mois, **cumulativement** depuis toujours. La nouvelle compte les dépôts rattachés à rien **du mois**. C'est plus juste (un dépôt d'il y a six mois n'est pas un blocage du mois d'août) et cohérent avec le dossier `05-depots-orphelins/` de l'export.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm vitest run src/lib/queries/__tests__/cloture.test.ts src/lib/services/export/__tests__/`
Expected: PASS (21 tests au total).

- [ ] **Step 5: Run the full suite for regressions**

Run: `cd web && pnpm vitest run`
Expected: PASS. Si un test existant casse sur les compteurs de `/cloture`, c'est l'effet attendu du filtre `obsolete_at` — mettre à jour l'attendu du test et **noter le changement dans le message de commit**, ne pas retirer le filtre.

- [ ] **Step 6: Commit**

```bash
cd web && pnpm lint
git add src/lib/queries/cloture.ts src/lib/queries/__tests__/cloture.test.ts
git commit -m "cloture: rebase les blockers sur les contrôles partagés de l'export"
```

---

# Phase 2 — Dump technique

### Task 6: Classification des tables

**Files:**
- Create: `web/src/lib/services/export/tables.ts`
- Test: `web/src/lib/services/export/__tests__/tables.test.ts`

**Interfaces:**
- Produces:

```typescript
export type RegimeSelection = 'group_id' | 'global' | 'par_fk';
export interface TableExport {
  nom: string;
  regime: RegimeSelection;
  // Pour 'par_fk' : la jointure qui borne au groupe.
  parent?: { table: string; cleLocale: string; cleParent: string };
}
export const TABLES_INCLUSES: TableExport[];
export const TABLES_EXCLUES: string[];
export function classifierTables(toutesLesTables: string[]):
  { manquantes: string[]; inconnues: string[] };
```

`classifierTables` renvoie les tables du schéma réel qui ne sont déclarées nulle part (`manquantes`) et les tables déclarées qui n'existent plus (`inconnues`). C'est le garde-fou : une table d'authentification ajoutée plus tard ne peut pas partir silencieusement dans un dump.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/lib/services/export/__tests__/tables.test.ts
import { describe, it, expect } from 'vitest';
import { TABLES_INCLUSES, TABLES_EXCLUES, classifierTables } from '../tables';

describe('classification des tables', () => {
  it('exclut toutes les tables d’authentification et de secrets', () => {
    for (const t of [
      'comptaweb_credentials', 'api_tokens', 'oauth_clients', 'oauth_access_tokens',
      'oauth_authorization_codes', 'sessions', 'login_codes', 'signin_attempts',
      'verification_tokens', 'invite_links',
    ]) {
      expect(TABLES_EXCLUES).toContain(t);
    }
  });

  it('ne déclare jamais une table à la fois incluse et exclue', () => {
    const incluses = TABLES_INCLUSES.map((t) => t.nom);
    expect(incluses.filter((n) => TABLES_EXCLUES.includes(n))).toEqual([]);
  });

  it('traite categories et modes_paiement comme des référentiels globaux', () => {
    // Ces deux tables n'ont PAS de colonne group_id : les filtrer dessus
    // renverrait zéro ligne et viderait les libellés du dossier d'exercice.
    for (const nom of ['categories', 'modes_paiement']) {
      expect(TABLES_INCLUSES.find((t) => t.nom === nom)?.regime).toBe('global');
    }
  });

  it('borne par FK les tables filles sans group_id', () => {
    // signatures et remboursement_lignes n'ont pas de group_id : un SELECT *
    // exporterait les données de tous les groupes une fois le multi-tenant
    // activé (P3).
    for (const nom of ['signatures', 'remboursement_lignes', 'remboursement_ligne_justificatifs']) {
      const t = TABLES_INCLUSES.find((x) => x.nom === nom);
      expect(t?.regime).toBe('par_fk');
      expect(t?.parent).toBeDefined();
    }
  });

  it('signale une table du schéma qui n’est classée nulle part', () => {
    const r = classifierTables(['ecritures', 'table_toute_neuve']);
    expect(r.manquantes).toEqual(['table_toute_neuve']);
  });

  it('signale une table déclarée qui n’existe plus', () => {
    const r = classifierTables(['ecritures']);
    expect(r.inconnues).toContain('justificatifs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/tables.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

Construire `TABLES_INCLUSES` et `TABLES_EXCLUES` à partir de la liste réelle des tables. La vérifier d'abord :

```bash
cd web && pnpm tsx -e "import {getDb} from './src/lib/db'; getDb().prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name\").all().then(r => console.log(r.map(x => x.name).join('\n')))"
```

```typescript
// web/src/lib/services/export/tables.ts
// Quelles tables partent dans un dump, et comment on borne leurs lignes au
// groupe. Module pur : aucune SQL ici, juste la déclaration.
//
// INVARIANT : toute table du schéma est soit incluse, soit explicitement
// exclue. `classifierTables` le vérifie contre le schéma réel, et le test
// échoue si une table nouvelle n'a pas été classée — sinon une table
// d'authentification ajoutée plus tard partirait silencieusement dans les
// dumps suivants.

export type RegimeSelection = 'group_id' | 'global' | 'par_fk';

export interface TableExport {
  nom: string;
  regime: RegimeSelection;
  parent?: { table: string; cleLocale: string; cleParent: string };
}

export const TABLES_EXCLUES: string[] = [
  'comptaweb_credentials',
  'api_tokens',
  'oauth_clients',
  'oauth_access_tokens',
  'oauth_authorization_codes',
  'sessions',
  'login_codes',
  'signin_attempts',
  'verification_tokens',
  'invite_links',
];

export const TABLES_INCLUSES: TableExport[] = [
  { nom: 'groupes', regime: 'group_id' },
  { nom: 'ecritures', regime: 'group_id' },
  { nom: 'justificatifs', regime: 'group_id' },
  { nom: 'depots_justificatifs', regime: 'group_id' },
  { nom: 'remboursements', regime: 'group_id' },
  { nom: 'abandons_frais', regime: 'group_id' },
  { nom: 'mouvements_caisse', regime: 'group_id' },
  { nom: 'depots_cheques', regime: 'group_id' },
  { nom: 'depots_especes', regime: 'group_id' },
  { nom: 'camps', regime: 'group_id' },
  { nom: 'cartes', regime: 'group_id' },
  { nom: 'comptes_bancaires', regime: 'group_id' },
  { nom: 'personnes', regime: 'group_id' },
  { nom: 'unites', regime: 'group_id' },
  { nom: 'activites', regime: 'group_id' },
  { nom: 'budgets', regime: 'group_id' },
  { nom: 'repartitions_unites', regime: 'group_id' },
  { nom: 'notes', regime: 'group_id' },
  { nom: 'todos', regime: 'group_id' },
  { nom: 'users', regime: 'group_id' },
  { nom: 'comptaweb_imports', regime: 'group_id' },
  { nom: 'sync_runs', regime: 'group_id' },
  { nom: 'error_log', regime: 'group_id' },
  { nom: 'cw_link_suggestions', regime: 'group_id' },
  { nom: 'inbox_suggestion_rejets', regime: 'group_id' },

  // Référentiels partagés par tous les groupes : pas de colonne group_id.
  { nom: 'categories', regime: 'global' },
  { nom: 'modes_paiement', regime: 'global' },

  // Tables filles sans group_id : bornées par jointure sur leur parent.
  {
    nom: 'remboursement_lignes',
    regime: 'par_fk',
    parent: { table: 'remboursements', cleLocale: 'remboursement_id', cleParent: 'id' },
  },
  {
    nom: 'remboursement_ligne_justificatifs',
    regime: 'par_fk',
    parent: { table: 'remboursement_lignes', cleLocale: 'ligne_id', cleParent: 'id' },
  },
  {
    nom: 'signatures',
    regime: 'par_fk',
    parent: { table: 'remboursements', cleLocale: 'document_id', cleParent: 'id' },
  },
  {
    nom: 'budget_lignes',
    regime: 'par_fk',
    parent: { table: 'budgets', cleLocale: 'budget_id', cleParent: 'id' },
  },
  {
    nom: 'avances_camp',
    regime: 'par_fk',
    parent: { table: 'camps', cleLocale: 'camp_id', cleParent: 'id' },
  },
  {
    nom: 'comptaweb_lignes',
    regime: 'par_fk',
    parent: { table: 'comptaweb_imports', cleLocale: 'import_id', cleParent: 'id' },
  },
  {
    nom: 'user_unites',
    regime: 'par_fk',
    parent: { table: 'users', cleLocale: 'user_id', cleParent: 'id' },
  },
];

export function classifierTables(toutesLesTables: string[]): {
  manquantes: string[];
  inconnues: string[];
} {
  const declarees = new Set([...TABLES_INCLUSES.map((t) => t.nom), ...TABLES_EXCLUES]);
  const reelles = new Set(toutesLesTables);
  return {
    manquantes: toutesLesTables.filter((t) => !declarees.has(t)),
    inconnues: [...declarees].filter((t) => !reelles.has(t)),
  };
}
```

**Important** : corriger cette liste avec la sortie réelle de la commande ci-dessus. Vérifier en particulier le nom des colonnes de jointure (`signatures.document_id`, `remboursement_ligne_justificatifs.ligne_id`) en lisant les `CREATE TABLE` correspondants — ne pas les deviner.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/tables.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the completeness test against the real schema**

```typescript
// à ajouter dans web/src/lib/services/export/__tests__/tables.test.ts
import { getDb } from '../../../db';

describe('complétude face au schéma réel', () => {
  it('classe toutes les tables de la base', async () => {
    const rows = await getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all<{ name: string }>();
    const { manquantes } = classifierTables(rows.map((r) => r.name));
    expect(manquantes).toEqual([]);
  });
});
```

Ce test touche la vraie base et échouera en CI sans `DB_URL`. L'encadrer de `describe.skipIf(!process.env.DB_URL)` pour qu'il ne tourne qu'en local, et le documenter dans le commentaire du fichier.

- [ ] **Step 6: Commit**

```bash
cd web && pnpm lint
git add src/lib/services/export/tables.ts src/lib/services/export/__tests__/tables.test.ts
git commit -m "export: classification des tables et garde-fou de complétude"
```

---

### Task 7: Caviardage des champs sensibles

**Files:**
- Create: `web/src/lib/services/export/caviardage.ts`
- Test: `web/src/lib/services/export/__tests__/caviardage.test.ts`

**Interfaces:**
- Produces:

```typescript
export const CHAMPS_SENSIBLES: Record<string, string[]>;
export function caviarder(table: string, ligne: Record<string, unknown>): Record<string, unknown>;
```

`caviarder` **retire** la clé plutôt que de la mettre à `null` : une clé présente à `null` laisse croire que la donnée n'existait pas, alors qu'elle a été retirée. La différence compte à la relecture d'une archive trois ans plus tard.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/lib/services/export/__tests__/caviardage.test.ts
import { describe, it, expect } from 'vitest';
import { caviarder, CHAMPS_SENSIBLES } from '../caviardage';

describe('caviarder', () => {
  const remb = {
    id: 'REMB-1',
    demandeur: 'Pierre',
    email: 'pierre@example.org',
    rib_texte: 'FR76 3000 4000 0512 3456 7890 143',
    rib_file_path: 'blob/rib/REMB-1.pdf',
    edit_token: 'tok_edit_abc123',
    validate_token: 'tok_val_def456',
    total_cents: 4200,
  };

  it('retire RIB et tokens d’un remboursement', () => {
    const r = caviarder('remboursements', remb);
    expect(r).not.toHaveProperty('rib_texte');
    expect(r).not.toHaveProperty('rib_file_path');
    expect(r).not.toHaveProperty('edit_token');
    expect(r).not.toHaveProperty('validate_token');
  });

  it('conserve les champs nécessaires à la lecture de l’archive', () => {
    const r = caviarder('remboursements', remb);
    expect(r.id).toBe('REMB-1');
    expect(r.demandeur).toBe('Pierre');
    expect(r.total_cents).toBe(4200);
    // L'email reste : un successeur doit pouvoir recontacter le demandeur.
    expect(r.email).toBe('pierre@example.org');
  });

  it('ne laisse aucune valeur sensible dans la sortie sérialisée', () => {
    const serialise = JSON.stringify(caviarder('remboursements', remb));
    expect(serialise).not.toContain('FR76');
    expect(serialise).not.toContain('tok_edit_abc123');
    expect(serialise).not.toContain('tok_val_def456');
    expect(serialise).not.toContain('blob/rib');
  });

  it('retire la clé au lieu de la mettre à null', () => {
    const r = caviarder('remboursements', remb);
    expect(Object.keys(r)).not.toContain('rib_texte');
  });

  it('laisse intacte une table sans champ sensible', () => {
    const ecr = { id: 'ECR-1', description: 'Intermarché', amount_cents: 8777 };
    expect(caviarder('ecritures', ecr)).toEqual(ecr);
  });

  it('déclare au moins les quatre champs sensibles des remboursements', () => {
    expect(CHAMPS_SENSIBLES.remboursements.sort()).toEqual(
      ['edit_token', 'rib_file_path', 'rib_texte', 'validate_token'],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/caviardage.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/lib/services/export/caviardage.ts
// Retrait des champs sensibles avant qu'une ligne ne quitte Baloo.
//
// Appliqué au DOSSIER D'EXERCICE uniquement — le dump technique reste chez le
// trésorier et doit être fidèle (cf. ADR-040).
//
// `edit_token` et `validate_token` sont le point critique : ce sont les liens
// d'accès direct aux remboursements. Diffusés dans un Drive partagé, ils
// permettraient de modifier ou valider un remboursement EN PRODUCTION.

export const CHAMPS_SENSIBLES: Record<string, string[]> = {
  remboursements: ['rib_texte', 'rib_file_path', 'edit_token', 'validate_token'],
};

/**
 * Retire les champs sensibles d'une ligne. La clé est SUPPRIMÉE, pas mise à
 * null : une clé à null laisserait croire que la donnée n'existait pas.
 */
export function caviarder(
  table: string,
  ligne: Record<string, unknown>,
): Record<string, unknown> {
  const champs = CHAMPS_SENSIBLES[table];
  if (!champs) return ligne;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ligne)) {
    if (!champs.includes(k)) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/caviardage.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd web && pnpm lint
git add src/lib/services/export/caviardage.ts src/lib/services/export/__tests__/caviardage.test.ts
git commit -m "export: caviardage des RIB et des tokens d'accès"
```

---

### Task 8: Collecte des lignes selon le régime de sélection

**Files:**
- Create: `web/src/lib/services/export/collecte.ts`
- Test: `web/src/lib/services/export/__tests__/collecte.test.ts`

**Interfaces:**
- Consumes: `TableExport`, `TABLES_INCLUSES` (Task 6) ; `caviarder` (Task 7) ; `DbWrapper`.
- Produces:

```typescript
export function sqlPourTable(t: TableExport): { sql: string; args: (s: string) => string[] };
export async function collecterTable(
  db: DbWrapper, groupId: string, t: TableExport,
  options?: { caviarder?: boolean },
): Promise<Record<string, unknown>[]>;
```

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/lib/services/export/__tests__/collecte.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../../db';
import { sqlPourTable, collecterTable } from '../collecte';

let db: DbWrapper;

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, description TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE remboursements (
      id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT,
      rib_texte TEXT, edit_token TEXT
    );
    CREATE TABLE remboursement_lignes (id TEXT PRIMARY KEY, remboursement_id TEXT, libelle TEXT);
  `);
  await db.prepare(`INSERT INTO ecritures VALUES ('E1', 'g', 'à nous'), ('E2', 'autre', 'pas à nous')`).run();
  await db.prepare(`INSERT INTO categories VALUES ('C1', 'Alimentation')`).run();
  await db
    .prepare(`INSERT INTO remboursements VALUES ('R1', 'g', 'Pierre', 'FR76 1234', 'tok_abc'), ('R2', 'autre', 'X', NULL, NULL)`)
    .run();
  await db
    .prepare(`INSERT INTO remboursement_lignes VALUES ('L1', 'R1', 'Essence'), ('L2', 'R2', 'Autre groupe')`)
    .run();
});

describe('collecterTable', () => {
  it('filtre sur group_id quand la table en porte un', async () => {
    const rows = await collecterTable(db, 'g', { nom: 'ecritures', regime: 'group_id' });
    expect(rows.map((r) => r.id)).toEqual(['E1']);
  });

  it('exporte un référentiel global en entier', async () => {
    const rows = await collecterTable(db, 'g', { nom: 'categories', regime: 'global' });
    expect(rows.map((r) => r.id)).toEqual(['C1']);
  });

  it('borne une table fille par jointure sur son parent', async () => {
    const rows = await collecterTable(db, 'g', {
      nom: 'remboursement_lignes',
      regime: 'par_fk',
      parent: { table: 'remboursements', cleLocale: 'remboursement_id', cleParent: 'id' },
    });
    expect(rows.map((r) => r.id)).toEqual(['L1']);
  });

  it('ne caviarde pas par défaut (le dump doit être fidèle)', async () => {
    const rows = await collecterTable(db, 'g', { nom: 'remboursements', regime: 'group_id' });
    expect(rows[0].rib_texte).toBe('FR76 1234');
  });

  it('caviarde sur demande (dossier d’exercice)', async () => {
    const rows = await collecterTable(
      db, 'g', { nom: 'remboursements', regime: 'group_id' }, { caviarder: true },
    );
    expect(rows[0]).not.toHaveProperty('rib_texte');
    expect(rows[0]).not.toHaveProperty('edit_token');
    expect(rows[0].demandeur).toBe('Pierre');
  });
});

describe('sqlPourTable', () => {
  it('refuse une table par_fk sans parent déclaré', () => {
    expect(() => sqlPourTable({ nom: 'signatures', regime: 'par_fk' })).toThrow(/parent/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/collecte.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/lib/services/export/collecte.ts
// Lecture des lignes d'une table selon son régime de sélection.
//
// Les noms de table et de colonne viennent de TABLES_INCLUSES (constante du
// code, jamais d'une entrée utilisateur) : ils sont interpolés dans le SQL,
// ce que le driver ne permet pas de paramétrer. Le groupId, lui, est toujours
// un paramètre lié.
import type { DbWrapper } from '../../db';
import type { TableExport } from './tables';
import { caviarder } from './caviardage';

export function sqlPourTable(t: TableExport): { sql: string; args: (groupId: string) => string[] } {
  switch (t.regime) {
    case 'global':
      return { sql: `SELECT * FROM ${t.nom}`, args: () => [] };
    case 'group_id':
      return { sql: `SELECT * FROM ${t.nom} WHERE group_id = ?`, args: (g) => [g] };
    case 'par_fk': {
      if (!t.parent) {
        throw new Error(`Table ${t.nom} en régime 'par_fk' sans parent déclaré`);
      }
      const p = t.parent;
      return {
        sql: `SELECT c.* FROM ${t.nom} c
                JOIN ${p.table} p ON p.${p.cleParent} = c.${p.cleLocale}
               WHERE p.group_id = ?`,
        args: (g) => [g],
      };
    }
  }
}

export async function collecterTable(
  db: DbWrapper,
  groupId: string,
  t: TableExport,
  options: { caviarder?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const { sql, args } = sqlPourTable(t);
  const rows = await db.prepare(sql).all<Record<string, unknown>>(...args(groupId));
  return options.caviarder ? rows.map((r) => caviarder(t.nom, r)) : rows;
}
```

Attention aux tables `par_fk` dont le parent n'a **pas** lui-même de `group_id` (`remboursement_ligne_justificatifs` → `remboursement_lignes`). Pour celles-là, la jointure doit remonter de deux crans. Si le cas se présente à l'implémentation, ajouter un second niveau optionnel au type `parent` plutôt que de bricoler le SQL — et ajouter un test dédié.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/collecte.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd web && pnpm lint
git add src/lib/services/export/collecte.ts src/lib/services/export/__tests__/collecte.test.ts
git commit -m "export: collecte des lignes par régime de sélection"
```

---

### Task 9: Script `export:dump` et contrôle des blobs manquants

**Files:**
- Create: `web/scripts/export-dump.ts`
- Modify: `web/package.json`
- Modify: `web/src/lib/services/export/controles.ts` (ajout de `controleBlobsManquants`)
- Modify: `web/src/lib/services/export/__tests__/controles.test.ts`

**Interfaces:**
- Consumes: `TABLES_INCLUSES`, `classifierTables` (Task 6) ; `collecterTable` (Task 8) ; `getCliContext` ; les helpers de `web/src/lib/storage.ts` — **lire ce fichier avant d'écrire le script** pour récupérer la fonction de téléchargement d'un blob par `file_path` et sa signature exacte.
- Produces: `controleBlobsManquants(justifs: Array<{ id: string; file_path: string; original_filename: string | null }>, existe: (p: string) => Promise<boolean>): Promise<Controle>`.

`controleBlobsManquants` reçoit la fonction `existe` en paramètre : la logique reste pure et testable, l'accès réseau reste dans le script.

- [ ] **Step 1: Write the failing test**

Ajouter à `web/src/lib/services/export/__tests__/controles.test.ts` :

```typescript
describe('controleBlobsManquants', () => {
  const justifs = [
    { id: 'JUS-1', file_path: 'blob/ok.jpg', original_filename: 'ok.jpg' },
    { id: 'JUS-2', file_path: 'blob/perdu.jpg', original_filename: 'perdu.jpg' },
  ];

  it('signale uniquement les fichiers absents du store', async () => {
    const existe = async (p: string) => p !== 'blob/perdu.jpg';
    const r = await controleBlobsManquants(justifs, existe);
    expect(r.lignes.map((l) => l.id)).toEqual(['JUS-2']);
    expect(r.lignes[0].libelle).toBe('perdu.jpg');
  });

  it('ne signale rien quand tout est là', async () => {
    const r = await controleBlobsManquants(justifs, async () => true);
    expect(r.lignes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/controles.test.ts`
Expected: FAIL — « controleBlobsManquants is not a function ».

- [ ] **Step 3: Write the implementation**

Ajouter à `web/src/lib/services/export/controles.ts` :

```typescript
/**
 * Fichiers référencés en base et introuvables dans le store. Seul contrôle
 * exigeant de la I/O : `existe` est injecté pour que la logique reste pure
 * et testable, et que l'accès réseau reste dans le script appelant.
 */
export async function controleBlobsManquants(
  justifs: Array<{ id: string; file_path: string; original_filename: string | null }>,
  existe: (filePath: string) => Promise<boolean>,
): Promise<Controle> {
  const lignes: LigneControle[] = [];
  for (const j of justifs) {
    if (!(await existe(j.file_path))) {
      lignes.push({
        id: j.id,
        date: null,
        libelle: j.original_filename ?? j.file_path,
        montantCents: 0,
        detail: j.file_path,
      });
    }
  }
  return { cle: 'blob_manquant', titre: 'Fichiers introuvables dans le store', lignes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/controles.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 5: Write the dump script**

```typescript
// web/scripts/export-dump.ts
// Dump technique complet : toutes les tables + tous les fichiers.
//
//   pnpm export:dump                    -> ./baloo-dump-YYYY-MM-DD/
//   pnpm export:dump /chemin/de/sortie
//
// Filet de sécurité, pas archive de passation : le contenu est FIDÈLE (RIB et
// tokens compris) et reste chez le trésorier. Cf. ADR-040.
//
// Reprenable : un blob déjà présent avec la bonne taille n'est pas
// retéléchargé. Relancer après une coupure reprend où ça s'est arrêté.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { getDb } from '../src/lib/db';
import { TABLES_INCLUSES, TABLES_EXCLUES, classifierTables } from '../src/lib/services/export/tables';
import { collecterTable } from '../src/lib/services/export/collecte';
import { getCliContext } from './cli-context';

async function main() {
  const jour = new Date().toISOString().slice(0, 10);
  const racine = process.argv[2] ?? `./baloo-dump-${jour}`;
  const { groupId } = await getCliContext();
  const db = getDb();

  // Garde-fou : une table non classée ne doit pas passer inaperçue.
  const toutes = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<{ name: string }>();
  const { manquantes } = classifierTables(toutes.map((t) => t.name));
  if (manquantes.length > 0) {
    throw new Error(
      `Tables non classées dans export/tables.ts : ${manquantes.join(', ')}.\n` +
        `Ajoute-les à TABLES_INCLUSES ou à TABLES_EXCLUES avant d'exporter.`,
    );
  }

  await mkdir(join(racine, 'tables'), { recursive: true });
  const compteurs: Record<string, number> = {};
  for (const t of TABLES_INCLUSES) {
    const rows = await collecterTable(db, groupId, t);
    const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
    await writeFile(join(racine, 'tables', `${t.nom}.jsonl`), jsonl + (rows.length ? '\n' : ''), 'utf-8');
    compteurs[t.nom] = rows.length;
    console.log(`  ${t.nom.padEnd(36)} ${rows.length}`);
  }

  // Les blobs : écrits sous leur id (stable), avec un index qui garde le nom
  // d'origine et de quoi vérifier l'intégrité.
  const justifs = await db
    .prepare(
      `SELECT id, file_path, original_filename, mime_type, entity_type, entity_id
         FROM justificatifs WHERE group_id = ? ORDER BY id`,
    )
    .all<{
      id: string;
      file_path: string;
      original_filename: string | null;
      mime_type: string | null;
      entity_type: string | null;
      entity_id: string | null;
    }>(groupId);

  await mkdir(join(racine, 'blobs'), { recursive: true });
  const index: Array<Record<string, unknown>> = [];
  let telecharges = 0;
  let sautes = 0;
  for (const j of justifs) {
    const ext = (j.original_filename?.match(/\.[a-z0-9]+$/i) ?? [''])[0];
    const cible = join(racine, 'blobs', `${j.id}${ext}`);
    let octets: number;
    try {
      octets = (await stat(cible)).size;
      sautes += 1;
    } catch {
      const buf = await telechargerBlob(j.file_path);
      await mkdir(dirname(cible), { recursive: true });
      await writeFile(cible, buf);
      octets = buf.byteLength;
      telecharges += 1;
    }
    index.push({ ...j, fichier: `blobs/${j.id}${ext}`, octets });
  }
  await writeFile(join(racine, 'blobs', 'index.json'), JSON.stringify(index, null, 2), 'utf-8');

  const manifest = {
    genere_le: new Date().toISOString(),
    group_id: groupId,
    commit: gitCommit(),
    lignes_par_table: compteurs,
    blobs: { total: justifs.length, telecharges, deja_presents: sautes },
    tables_exclues: TABLES_EXCLUES,
  };
  await writeFile(join(racine, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\nDump écrit dans ${racine} (${justifs.length} fichiers, ${telecharges} téléchargés).`);
}

function gitCommit(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`telechargerBlob(file_path): Promise<Buffer>` n'est pas encore défini : **lire `web/src/lib/storage.ts`** et soit réutiliser le helper existant de lecture, soit en extraire un. Ne pas réimplémenter l'accès Blob à côté.

Ajouter dans `web/package.json` : `"export:dump": "tsx scripts/export-dump.ts"`.

- [ ] **Step 6: Run the script**

Run: `cd web && pnpm export:dump /tmp/baloo-dump-test`
Expected: l'arborescence complète. Vérifier ensuite :

```bash
cat /tmp/baloo-dump-test/manifest.json
ls /tmp/baloo-dump-test/blobs | head
# Fidélité du dump : les RIB DOIVENT être présents ici.
grep -c rib_texte /tmp/baloo-dump-test/tables/remboursements.jsonl
# Aucune table d'authentification ne doit exister.
ls /tmp/baloo-dump-test/tables | grep -E 'oauth|session|token|credential'
```

La dernière commande ne doit rien renvoyer. Relancer le script une deuxième fois et vérifier que `telecharges` vaut 0 (reprise).

- [ ] **Step 7: Commit**

```bash
cd web && pnpm lint
git add src/lib/services/export/controles.ts src/lib/services/export/__tests__/controles.test.ts scripts/export-dump.ts package.json
git commit -m "export: dump technique complet et contrôle des blobs manquants"
```

---

# Phase 3 — Dossier d'exercice

### Task 10: Extraire le formateur CSV partagé

**Files:**
- Create: `web/src/lib/csv.ts`
- Modify: `web/src/app/api/ecritures/export/route.ts:16-35` (retirer les helpers locaux, importer)
- Test: `web/src/lib/__tests__/csv.test.ts`

**Interfaces:**
- Produces:

```typescript
export function escapeCsv(value: unknown): string;
export function formatAmountCsv(cents: number): string;
export function buildCsv(headers: string[], rows: unknown[][]): string;
```

`buildCsv` préfixe le BOM UTF-8 et joint en CRLF — c'est ce qui fait qu'Excel FR ouvre le fichier sans charabia. Comportement déjà validé en prod par la route existante : ne rien changer, juste déplacer.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/lib/__tests__/csv.test.ts
import { describe, it, expect } from 'vitest';
import { escapeCsv, formatAmountCsv, buildCsv } from '../csv';

describe('escapeCsv', () => {
  it('laisse une valeur simple intacte', () => {
    expect(escapeCsv('Intermarché')).toBe('Intermarché');
  });
  it('entoure et double les guillemets quand il le faut', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('il a dit "oui"')).toBe('"il a dit ""oui"""');
    expect(escapeCsv('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });
  it('rend null et undefined comme une chaîne vide', () => {
    expect(escapeCsv(null)).toBe('');
    expect(escapeCsv(undefined)).toBe('');
  });
});

describe('formatAmountCsv', () => {
  it('formate en virgule décimale sans séparateur de milliers', () => {
    expect(formatAmountCsv(8777)).toBe('87,77');
    expect(formatAmountCsv(197757)).toBe('1977,57');
    expect(formatAmountCsv(-1059)).toBe('-10,59');
    expect(formatAmountCsv(5)).toBe('0,05');
  });
});

describe('buildCsv', () => {
  it('préfixe le BOM UTF-8 et joint en CRLF', () => {
    const csv = buildCsv(['id', 'montant'], [['E1', '87,77']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('id,montant\r\nE1,87,77');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/__tests__/csv.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Move the helpers**

Créer `web/src/lib/csv.ts` en **déplaçant** `escapeCsv` et `formatAmountCsv` depuis `web/src/app/api/ecritures/export/route.ts` (code et commentaires inchangés), et ajouter :

```typescript
/**
 * Assemble un CSV prêt pour Excel FR : BOM UTF-8 en tête (sinon les accents
 * partent en charabia à l'ouverture) et lignes jointes en CRLF (RFC 4180).
 */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lignes = [headers.join(','), ...rows.map((r) => r.map(escapeCsv).join(','))];
  return '﻿' + lignes.join('\r\n');
}
```

Dans la route, retirer les deux fonctions locales, ajouter `import { escapeCsv, formatAmountCsv, buildCsv } from '@/lib/csv';` et remplacer la construction finale du CSV par `buildCsv(headers, ecritures.map(...))`.

- [ ] **Step 4: Run tests and verify the route still works**

Run: `cd web && pnpm vitest run src/lib/__tests__/csv.test.ts && pnpm lint && pnpm build`
Expected: PASS, lint clean, build OK.

Puis vérifier à la main : lancer `pnpm dev`, ouvrir `/ecritures`, cliquer l'export CSV, ouvrir le fichier — les accents doivent être corrects et les montants en virgule décimale.

- [ ] **Step 5: Commit**

```bash
cd web && pnpm lint
git add src/lib/csv.ts src/lib/__tests__/csv.test.ts src/app/api/ecritures/export/route.ts
git commit -m "csv: extrait le formateur partagé de la route d'export"
```

---

### Task 11: Noms de dossiers et de fichiers sûrs

**Files:**
- Create: `web/src/lib/services/export/arborescence.ts`
- Test: `web/src/lib/services/export/__tests__/arborescence.test.ts`

**Interfaces:**
- Produces:

```typescript
export function slug(texte: string, maxLen?: number): string;
export function dossierEcriture(e: { id: string; date_ecriture: string | null;
  numero_piece: string | null; description: string | null }): string;
export function dossierRemboursement(r: { id: string; demandeur: string | null }): string;
```

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/lib/services/export/__tests__/arborescence.test.ts
import { describe, it, expect } from 'vitest';
import { slug, dossierEcriture, dossierRemboursement } from '../arborescence';

describe('slug', () => {
  it('translittère les accents', () => {
    expect(slug('Intermarché Péage')).toBe('intermarche-peage');
  });
  it('neutralise les caractères interdits par le système de fichiers', () => {
    expect(slug('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });
  it('écrase les séparateurs répétés et rogne les bords', () => {
    expect(slug('  --a   b--  ')).toBe('a-b');
  });
  it('tronque sans couper au milieu d’un séparateur', () => {
    expect(slug('abcdefghij klmnop', 10)).toBe('abcdefghij');
    expect(slug('abcde fghijklmn', 6)).toBe('abcde');
  });
  it('ne renvoie jamais une chaîne vide', () => {
    expect(slug('///')).toBe('sans-titre');
    expect(slug('')).toBe('sans-titre');
  });
});

describe('dossierEcriture', () => {
  it('préfixe par la date pour un tri chronologique naturel', () => {
    expect(
      dossierEcriture({
        id: 'ECR-2026-042', date_ecriture: '2026-08-05',
        numero_piece: 'PI-17', description: 'Intermarché camp',
      }),
    ).toBe('2026-08-05-PI-17-intermarche-camp');
  });
  it('retombe sur l’id quand la pièce manque', () => {
    expect(
      dossierEcriture({
        id: 'ECR-2026-042', date_ecriture: '2026-08-05',
        numero_piece: null, description: 'Essence',
      }),
    ).toBe('2026-08-05-ECR-2026-042-essence');
  });
  it('gère une écriture sans date', () => {
    expect(
      dossierEcriture({ id: 'ECR-1', date_ecriture: null, numero_piece: null, description: null }),
    ).toBe('sans-date-ECR-1-sans-titre');
  });
});

describe('dossierRemboursement', () => {
  it('combine id et demandeur', () => {
    expect(dossierRemboursement({ id: 'REMB-2026-007', demandeur: 'Pierre Dupont' }))
      .toBe('REMB-2026-007-pierre-dupont');
  });
  it('gère un demandeur absent', () => {
    expect(dossierRemboursement({ id: 'REMB-1', demandeur: null })).toBe('REMB-1-sans-titre');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/arborescence.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/lib/services/export/arborescence.ts
// Noms de dossiers et de fichiers de l'archive. Module pur : aucun accès au
// système de fichiers, juste la construction des noms.
//
// L'archive atterrit dans un Drive puis, potentiellement, sur Windows et
// macOS : on translittère les accents, on neutralise tout ce qui est interdit
// quelque part, et on borne la longueur.

const MAX_SEGMENT = 60;

export function slug(texte: string, maxLen: number = MAX_SEGMENT): string {
  const base = texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (base.length === 0) return 'sans-titre';
  if (base.length <= maxLen) return base;
  // Tronquer au dernier séparateur pour ne pas couper un mot en deux.
  const coupe = base.slice(0, maxLen);
  const dernier = coupe.lastIndexOf('-');
  return (dernier > 0 ? coupe.slice(0, dernier) : coupe).replace(/-$/, '');
}

export function dossierEcriture(e: {
  id: string;
  date_ecriture: string | null;
  numero_piece: string | null;
  description: string | null;
}): string {
  const date = e.date_ecriture ?? 'sans-date';
  const piece = e.numero_piece ?? e.id;
  return `${date}-${piece}-${slug(e.description ?? '')}`;
}

export function dossierRemboursement(r: { id: string; demandeur: string | null }): string {
  return `${r.id}-${slug(r.demandeur ?? '')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/export/__tests__/arborescence.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
cd web && pnpm lint
git add src/lib/services/export/arborescence.ts src/lib/services/export/__tests__/arborescence.test.ts
git commit -m "export: noms de dossiers sûrs pour l'archive"
```

---

### Task 12: Script `export:exercice` — CSV et référentiels

**Files:**
- Create: `web/scripts/export-exercice.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: `bornesPourExercice` (1), `rapportControles` / `formatRapportTexte` (4), `collecterTable` (8), `buildCsv` / `formatAmountCsv` (10), `dossierEcriture` / `dossierRemboursement` (11), `getCliContext`.
- Produces: le squelette du dossier — README, CSV de chaque section, référentiels. **Les fichiers viennent en Task 13**, l'index HTML en Task 14.

Cette tâche s'arrête à ce qui ne demande aucun téléchargement : c'est ce qui permet de la vérifier vite et de committer un dossier déjà lisible.

- [ ] **Step 1: Write the script**

```typescript
// web/scripts/export-exercice.ts
// Dossier d'archive d'un exercice, lisible sans Baloo.
//
//   pnpm export:exercice 2025-2026
//   pnpm export:exercice 2025-2026 /chemin/de/sortie
//
// Destiné au Drive du groupe : le contenu est CAVIARDÉ (ni RIB, ni tokens
// d'accès). Cf. ADR-040.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '../src/lib/db';
import { buildCsv, formatAmountCsv } from '../src/lib/csv';
import { bornesPourExercice } from '../src/lib/services/export/bornes';
import { rapportControles, formatRapportTexte } from '../src/lib/services/export/controles';
import { collecterTable } from '../src/lib/services/export/collecte';
import { TABLES_INCLUSES } from '../src/lib/services/export/tables';
import { getCliContext } from './cli-context';

const REFERENTIELS = [
  'unites', 'categories', 'activites', 'modes_paiement',
  'comptes_bancaires', 'cartes', 'camps', 'personnes',
];

async function main() {
  const exercice = process.argv[2];
  if (!exercice) throw new Error('Usage : pnpm export:exercice <exercice> [sortie]\nEx. : pnpm export:exercice 2025-2026');
  const bornes = bornesPourExercice(exercice);
  const racine = process.argv[3] ?? `./exercice-${exercice}`;
  const { groupId } = await getCliContext();
  const db = getDb();

  for (const d of [
    '01-ecritures', '02-remboursements', '03-abandons', '04-caisse',
    '05-depots-orphelins', '06-referentiels', '07-memoire', '08-comptaweb',
  ]) {
    await mkdir(join(racine, d), { recursive: true });
  }

  // 1. Les contrôles d'abord : ils ouvrent le README, c'est ce qu'on lit en
  //    premier en rouvrant l'archive dans trois ans.
  const controles = await rapportControles(db, groupId, bornes);

  // 2. Les référentiels : sans eux, les CSV ne contiennent que des ids.
  for (const nom of REFERENTIELS) {
    const t = TABLES_INCLUSES.find((x) => x.nom === nom);
    if (!t) throw new Error(`Référentiel ${nom} absent de TABLES_INCLUSES`);
    const rows = await collecterTable(db, groupId, t, { caviarder: true });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : ['id'];
    await writeFile(
      join(racine, '06-referentiels', `${nom}.csv`),
      buildCsv(headers, rows.map((r) => headers.map((h) => r[h]))),
      'utf-8',
    );
  }

  // 3. Les CSV de chaque section, bornés à l'exercice.
  await ecrireEcritures(db, groupId, bornes, racine);
  await ecrireRemboursements(db, groupId, bornes, racine);
  await ecrireAbandons(db, groupId, bornes, racine);
  await ecrireCaisse(db, groupId, bornes, racine);
  await ecrireAvancesCamp(db, groupId, bornes, racine);
  await ecrireMemoire(db, groupId, racine);

  // 4. Le README, avec les contrôles en tête.
  await writeFile(
    join(racine, 'README.md'),
    [
      `# Archive de l'exercice ${exercice}`,
      '',
      `Groupe : ${groupId} · Période : ${bornes.debut} → ${bornes.fin}`,
      `Export généré le ${new Date().toISOString().slice(0, 10)} par \`pnpm export:exercice\`.`,
      '',
      'Les RIB et les liens d’accès direct aux remboursements ont été retirés de cette archive.',
      '',
      '## Contrôles de cohérence',
      '',
      '```',
      formatRapportTexte(controles, bornes),
      '```',
      '',
    ].join('\n'),
    'utf-8',
  );

  console.log(`Dossier écrit dans ${racine}.`);
}
```

Voici le patron complet, sur `ecrireEcritures`. Les autres fonctions le suivent à l'identique, en changeant la table, les bornes et les colonnes.

```typescript
// Le `status` est une colonne à part entière du CSV : c'est ce qui permet à
// un lecteur de voir qu'une écriture n'était pas matérialisée dans Comptaweb
// au moment de l'archivage.
async function ecrireEcritures(
  db: ReturnType<typeof getDb>,
  groupId: string,
  bornes: { debut: string; fin: string },
  racine: string,
) {
  const rows = await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.type, e.description, e.amount_cents,
              u.code AS unite, c.name AS categorie, m.name AS mode_paiement,
              a.name AS activite, e.status, e.numero_piece,
              e.comptaweb_ecriture_id, e.justif_attendu, e.notes
         FROM ecritures e
         LEFT JOIN unites u ON u.id = e.unite_id
         LEFT JOIN categories c ON c.id = e.category_id
         LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
         LEFT JOIN activites a ON a.id = e.activite_id
        WHERE e.group_id = ? AND e.date_ecriture >= ? AND e.date_ecriture <= ?
        ORDER BY e.date_ecriture, e.id`,
    )
    .all<Record<string, unknown>>(groupId, bornes.debut, bornes.fin);

  const headers = [
    'id', 'date', 'type', 'description', 'montant', 'unite', 'categorie',
    'mode_paiement', 'activite', 'statut', 'numero_piece', 'comptaweb_id',
    'justif_attendu', 'notes',
  ];
  await writeFile(
    join(racine, '01-ecritures', 'ecritures.csv'),
    buildCsv(headers, rows.map((r) => [
      r.id, r.date_ecriture, r.type, r.description,
      formatAmountCsv(Number(r.amount_cents ?? 0)),
      r.unite ?? '', r.categorie ?? '', r.mode_paiement ?? '', r.activite ?? '',
      r.status, r.numero_piece ?? '', r.comptaweb_ecriture_id ?? '',
      r.justif_attendu ? 'oui' : 'non', r.notes ?? '',
    ])),
    'utf-8',
  );
}
```

Les quatre autres, sur ce patron :

| Fonction | Table et borne | Sortie |
|---|---|---|
| `ecrireRemboursements` | `remboursements`, borné sur `COALESCE(date_depense, created_at)` entre `bornes.debut` et `bornes.finInclusiveTs`. Colonnes : id, demandeur, email, total, date, nature, unité, statut, date_paiement, écriture liée. **Jamais `rib_texte`, `rib_file_path`, `edit_token`, `validate_token`.** Plus une colonne `feuille_signee` (oui/non) issue de l'existence d'un justificatif `remboursement_feuille`. | `02-remboursements/remboursements.csv` |
| `ecrireAbandons` | `abandons_frais`, borné sur `date_depense`. | `03-abandons/abandons.csv` |
| `ecrireCaisse` | `mouvements_caisse`, `depots_especes`, `depots_cheques`, bornés sur leur date d'opération. | trois CSV dans `04-caisse/` |
| `ecrireAvancesCamp` | `avances_camp` jointe à `camps` pour le `group_id` et le nom du camp, bornée sur `date_versement`. Colonnes : id, camp, bénéficiaire, montant versé, **montant rendu**, mode, statut, écriture liée, notes. | `avances-camp.csv` à la racine |

Les **signatures** sont écrites par une fonction dédiée, appelée deux fois — une par type de document :

```typescript
// La chaîne de signature est la valeur probante : sans elle, un PDF signé
// n'est qu'un PDF. Elle est donc exportée à côté des documents, pas seulement
// imprimée dans l'encart du PDF.
async function ecrireSignatures(
  db: ReturnType<typeof getDb>, groupId: string,
  documentType: 'remboursement' | 'abandon', dossier: string, racine: string,
) {
  const rows = await db
    .prepare(
      `SELECT s.* FROM signatures s
         JOIN ${documentType === 'remboursement' ? 'remboursements' : 'abandons_frais'} d
           ON d.id = s.document_id
        WHERE s.document_type = ? AND d.group_id = ?
        ORDER BY s.document_id, s.signed_at`,
    )
    .all<Record<string, unknown>>(documentType, groupId);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : ['document_id'];
  await writeFile(
    join(racine, dossier, 'signatures.csv'),
    buildCsv(headers, rows.map((r) => headers.map((h) => r[h]))),
    'utf-8',
  );
}
```

Vérifier le nom réel des colonnes de `signatures` (`document_type`, `document_id`, `signed_at`) dans son `CREATE TABLE` avant d'écrire cette requête — ne pas les déduire de cet exemple.

`ecrireMemoire` écrit `notes.md` et `todos.md` en markdown plutôt qu'en CSV : c'est de la prose, elle se lit mieux ainsi. Une note par section `## <titre>` avec sa date et son topic ; une todo par puce, cochée si `status = 'fait'`.

Ajouter dans `web/package.json` : `"export:exercice": "tsx scripts/export-exercice.ts"`.

- [ ] **Step 2: Run the script**

Run: `cd web && pnpm export:exercice 2025-2026 /tmp/exercice-test`
Expected: l'arborescence, les CSV remplis, le README avec les contrôles en tête.

- [ ] **Step 3: Verify the caviardage on the real output**

```bash
# Ces trois commandes NE DOIVENT RIEN renvoyer.
grep -ril 'rib' /tmp/exercice-test --include='*.csv'
grep -rl 'edit_token\|validate_token' /tmp/exercice-test
grep -rE 'FR[0-9]{2}[ ]?[0-9]{4}' /tmp/exercice-test
```

Si l'une d'elles renvoie quelque chose, **arrêter** et corriger avant de continuer : c'est la garantie centrale de l'ADR-040.

- [ ] **Step 4: Commit**

```bash
cd web && pnpm lint
git add scripts/export-exercice.ts package.json
git commit -m "export: dossier d'exercice, CSV et référentiels"
```

---

### Task 13: Téléchargement des fichiers dans l'arborescence

**Files:**
- Modify: `web/scripts/export-exercice.ts`

**Interfaces:**
- Consumes: `dossierEcriture`, `dossierRemboursement` (Task 11) ; le helper de lecture de blob identifié en Task 9.

- [ ] **Step 1: Add file download for écritures**

Pour chaque écriture de l'exercice, télécharger ses justificatifs dans `01-ecritures/justificatifs/<dossierEcriture(e)>/`. Les justificatifs dont `obsolete_at` n'est pas nul vont dans un sous-dossier `_obsoletes/` du même dossier.

Le helper à écrire, qui porte les deux subtilités (collision de noms et reprise) :

```typescript
// Écrit un justificatif dans `dossier`. Deux pièges traités ici :
//  - collision de noms : deux tickets photographiés s'appellent souvent tous
//    les deux « IMG_4821.jpg ». On suffixe par l'id plutôt que d'écraser en
//    silence — une pièce perdue à l'archivage ne se voit pas.
//  - reprise : un fichier déjà présent à la bonne taille n'est pas
//    retéléchargé, pour qu'une coupure se rattrape en relançant.
const nomsUtilises = new Map<string, Set<string>>();

async function ecrireJustificatif(
  j: { id: string; file_path: string; original_filename: string | null },
  dossier: string,
): Promise<void> {
  const nomBrut = j.original_filename ?? `${j.id}.bin`;
  const ext = (nomBrut.match(/\.[a-z0-9]+$/i) ?? [''])[0];
  let nom = `${slug(nomBrut.slice(0, nomBrut.length - ext.length))}${ext}`;

  const pris = nomsUtilises.get(dossier) ?? new Set<string>();
  if (pris.has(nom)) nom = `${slug(nomBrut.slice(0, nomBrut.length - ext.length))}-${j.id}${ext}`;
  pris.add(nom);
  nomsUtilises.set(dossier, pris);

  const cible = join(dossier, nom);
  try {
    if ((await stat(cible)).size > 0) return; // déjà là : reprise
  } catch {
    // pas encore téléchargé
  }
  await mkdir(dossier, { recursive: true });
  await writeFile(cible, await telechargerBlob(j.file_path));
}
```

`telechargerBlob` est le helper identifié en Task 9 dans `web/src/lib/storage.ts` — le même des deux côtés, pas une seconde implémentation.

- [ ] **Step 2: Add file download for remboursements and abandons**

Pour chaque remboursement : `02-remboursements/<dossierRemboursement(r)>/`, contenant la feuille PDF (`justificatifs` avec `entity_type = 'remboursement_feuille'`, nommée `feuille.pdf`) et les justificatifs des lignes. Un remboursement sans feuille reçoit un fichier `NON-SIGNE.txt` expliquant qu'aucune feuille n'a été générée faute de signature — le dossier vide serait ambigu.

Pour les abandons : même patron dans `03-abandons/<id>/`.

- [ ] **Step 3: Add orphan deposits**

Les dépôts remontés par `controleDepotsOrphelins` vont dans `05-depots-orphelins/<id>-<slug(titre)>/` avec leurs fichiers.

- [ ] **Step 4: Run and verify**

Run: `cd web && pnpm export:exercice 2025-2026 /tmp/exercice-test`

```bash
du -sh /tmp/exercice-test
find /tmp/exercice-test -name '*.pdf' | head
find /tmp/exercice-test -path '*_obsoletes*' | head
# Aucun dossier de remboursement ne doit être vide.
find /tmp/exercice-test/02-remboursements -type d -empty
```

Relancer et vérifier qu'aucun fichier n'est retéléchargé.

- [ ] **Step 5: Commit**

```bash
cd web && pnpm lint
git add scripts/export-exercice.ts
git commit -m "export: télécharge les justificatifs dans le dossier d'exercice"
```

---

### Task 14: Index HTML navigable hors-ligne

**Files:**
- Modify: `web/scripts/export-exercice.ts`

- [ ] **Step 1: Generate the index**

Écrire `index.html` à la racine du dossier : une page autonome, CSS inline, **aucune ressource externe** (elle doit s'ouvrir depuis un Drive téléchargé, sans réseau).

Contenu : en-tête (groupe, exercice, date d'export, mention du caviardage), le bloc des contrôles, puis une section par dossier avec un tableau des écritures / remboursements / abandons dont chaque ligne pointe en **lien relatif** vers le dossier de pièces correspondant.

Échapper le HTML de toute valeur venant de la base (`&`, `<`, `>`, `"`) — un libellé d'écriture contenant `<` casserait la page.

- [ ] **Step 2: Verify in a browser**

Run: `open /tmp/exercice-test/index.html`
Expected: la page s'affiche, les contrôles sont lisibles, un clic sur une écriture ouvre son dossier de pièces. Couper le réseau et recharger : rien ne doit changer.

- [ ] **Step 3: Commit**

```bash
cd web && pnpm lint
git add scripts/export-exercice.ts
git commit -m "export: index HTML navigable hors-ligne"
```

---

### Task 15: Documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `doc/roadmap.md`
- Modify: `web/README.md`

- [ ] **Step 1: Document the three commands**

Dans `web/README.md`, une section « Exports » : les trois commandes, ce que chacune produit, où va l'artefact, et la règle qui les sépare (dump fidèle et privé vs dossier caviardé et partageable).

- [ ] **Step 2: Update the CHANGELOG**

Le CHANGELOG s'arrête à P2.3 (2026-05-11) alors que quatre mois de features ont été livrés. Ajouter au minimum une entrée `[Unreleased]` pour l'export d'archive, avec un renvoi à l'ADR-040. Rattraper le retard sur les autres features est un chantier distinct — ne pas le faire ici.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md doc/roadmap.md web/README.md
git commit -m "doc: documente les exports d'archive"
```

---

## Notes d'exécution

**Vérifier avant de coder, ne pas deviner** :
- les colonnes de jointure de `signatures`, `remboursement_ligne_justificatifs`, `user_unites` (Task 6) ;
- la signature exacte du helper de lecture de blob dans `web/src/lib/storage.ts` (Task 9) ;
- la liste réelle des tables (`sqlite_master`), qui fait foi contre `tables.ts`.

**Si une table `par_fk` a un parent lui-même sans `group_id`** (cas de `remboursement_ligne_justificatifs`), remonter la jointure de deux crans via un type `parent` récursif plutôt qu'en bricolant le SQL au cas par cas — et ajouter le test correspondant.

**Le caviardage est la garantie centrale de ce chantier.** Les trois `grep` de la Task 12 Step 3 ne sont pas une formalité : un token d'accès qui part dans un Drive partagé donne à n'importe quel lecteur le droit de valider un remboursement en production.
