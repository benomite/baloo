# Phase 1 — Fondations MCP + interface Comptaweb assistée

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place les prérequis du pivot "miroir strict + MCP-first" : dépréciation de `compta/` standalone, statut enum `ecritures` étendu pour le cycle de vie miroir, et reformulation des pages de saisie en "interface Comptaweb assistée".

**Architecture:**
- Tools MCP centralisés dans `/api/mcp` (suppression du standalone `compta/`)
- Nouveau cycle de vie d'écriture via statut enum : `draft` → `pending_cw` → `pending_sync` → `mirror` (+ `divergent`)
- Pages de saisie passent par le scraper Comptaweb (`web/src/lib/comptaweb/`) en premier, puis attendent le sync ; jamais d'écriture locale qui n'existe pas dans CW

**Tech Stack:** Next.js 16 (App Router), Turso/libsql, Vitest, TypeScript, scraping Comptaweb (existant), Auth.js (existant)

**Spec de référence :** [doc/specs/2026-05-18-baloo-miroir-mcp-first-design.md](../specs/2026-05-18-baloo-miroir-mcp-first-design.md)

---

## Task 1 : Audit gap tools `compta/` vs `/api/mcp`

**Files:**
- Read: `compta/src/tools/*.ts` (24 fichiers)
- Read: `web/src/app/api/mcp/route.ts` (route Streamable HTTP)
- Read: `web/src/app/api/mcp/tools/` (si existe — sinon vérifier où sont registrés les tools côté webapp)
- Create: `doc/plans/2026-05-18-tools-portage-audit.md` (note d'audit, supprimable après Task 4)

- [ ] **Step 1: Lister les tools du standalone**

Run: `ls compta/src/tools/ | sort > /tmp/compta-tools.txt && cat /tmp/compta-tools.txt`

- [ ] **Step 2: Lister les tools enregistrés dans `/api/mcp`**

Identifier où les tools sont enregistrés dans la route. Probablement dans `web/src/app/api/mcp/route.ts` via `server.tool(...)`. Extraire la liste complète.

Run: `grep -rE "server\.tool\(|registerTool|name: '[a-z_]+'" web/src/app/api/mcp/ web/src/lib/mcp/ 2>/dev/null | sort -u`

- [ ] **Step 3: Comparer et identifier les gaps**

Pour chaque tool de `compta/src/tools/`, vérifier qu'il est enregistré dans `/api/mcp`. Considérer un tool comme "porté" si le nom du tool ET son comportement sont équivalents.

Note : un fichier `compta/src/tools/X.ts` peut contenir plusieurs tools (`register*Tools(server)`). Inventorier les noms des tools, pas juste les fichiers.

- [ ] **Step 4: Écrire la note d'audit**

Créer `doc/plans/2026-05-18-tools-portage-audit.md` avec :

```markdown
# Audit portage tools compta/ → /api/mcp

## Tools déjà portés (équivalence vérifiée)
- `nom_tool_1` → web/src/.../route.ts (ou file:line)
- ...

## Tools à porter (Task 2)
- `nom_tool_X` (source: compta/src/tools/X.ts:NNN) — endpoint API webapp existant : oui/non
- ...

## Tools obsolètes à NE PAS porter
- `nom_tool_Y` (raison : remplacé par Z, ou usage abandonné)
- ...
```

- [ ] **Step 5: Commit l'audit**

```bash
git add doc/plans/2026-05-18-tools-portage-audit.md
git commit -m "doc(plan-1): audit gap tools compta/ vs /api/mcp"
```

---

## Task 2 : Porter les tools manquants vers `/api/mcp`

**Files:**
- Modify: `web/src/app/api/mcp/route.ts` (ou wherever tools are registered)
- Create/modify : éventuellement nouveaux endpoints `web/src/app/api/...` si une route HTTP manque
- Test: `web/src/app/api/mcp/__tests__/tools.test.ts` (créer si pas exist)
- Reference: `doc/plans/2026-05-18-tools-portage-audit.md` (issu de Task 1)

**Note :** Chaque tool est un thin wrapper sur un endpoint HTTP de la webapp. Si l'endpoint n'existe pas, le créer d'abord. NE PAS dupliquer de logique métier dans le tool.

- [ ] **Step 1: Pour chaque tool de la liste "à porter", vérifier l'endpoint HTTP webapp**

Si l'endpoint existe (ex: `/api/abandons`) → passer à Step 2.
Si l'endpoint n'existe pas → le créer en se basant sur la logique du tool actuel (`compta/src/tools/<nom>.ts`). Suivre le pattern des routes existantes (`web/src/app/api/*/route.ts`).

- [ ] **Step 2: Écrire le test du tool dans `/api/mcp`**

Exemple pour un tool `list_abandons` :

```typescript
// web/src/app/api/mcp/__tests__/list_abandons.test.ts
import { describe, it, expect } from 'vitest';
import { callMcpTool } from './_helpers';

describe('mcp tool: list_abandons', () => {
  it('retourne la liste filtrée par group_id du token', async () => {
    const result = await callMcpTool('list_abandons', {}, { token: 'fixture_treso' });
    expect(result.content[0].type).toBe('text');
    const data = JSON.parse(result.content[0].text);
    expect(Array.isArray(data.items)).toBe(true);
  });
});
```

(Si `_helpers.ts` n'existe pas, le créer : un util qui simule un appel tool MCP avec un token donné en s'appuyant sur le code existant.)

- [ ] **Step 3: Run test, attendu : FAIL (tool pas encore enregistré)**

Run: `cd web && pnpm test -- list_abandons`
Expected: FAIL avec "tool not found" ou équivalent.

- [ ] **Step 4: Enregistrer le tool dans `/api/mcp`**

Dans la route MCP, ajouter :

```typescript
server.tool(
  'list_abandons',
  'Liste les abandons de frais du groupe',
  { /* schéma Zod des inputs si pertinent */ },
  async (args, extra) => {
    const { token } = extractAuthFromExtra(extra);
    const res = await fetch(`${INTERNAL_API_URL}/api/abandons`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  },
);
```

(Adapter au pattern réel utilisé dans le fichier — la signature `server.tool` et la façon d'extraire le token dépendent du setup MCP existant.)

- [ ] **Step 5: Run test, attendu : PASS**

Run: `cd web && pnpm test -- list_abandons`
Expected: PASS.

- [ ] **Step 6: Répéter Steps 2-5 pour chaque tool de la liste "à porter"**

Faire **un commit par tool porté** pour rester atomique :

```bash
git add web/src/app/api/mcp/route.ts web/src/app/api/mcp/__tests__/<tool>.test.ts
git commit -m "feat(mcp): porte tool <tool> depuis compta/ vers /api/mcp"
```

---

## Task 3 : Marquer `compta/` deprecated

**Files:**
- Modify: `compta/README.md` (créer si pas exist)
- Modify: `CLAUDE.md` (retirer mentions install / setup `compta/`)
- Modify: `doc/integrations.md` (retirer ou marquer dépréciée la section `compta` (Baloo BDD prod))

- [ ] **Step 1: Ajouter une note de dépréciation dans `compta/README.md`**

Créer le fichier (s'il n'existe pas) avec :

```markdown
# compta/ — DEPRECATED (sera supprimé)

Ce dossier contient l'ancien serveur MCP standalone (stdio) qui s'exécutait via `tsx` en local.

**Il est désormais déprécié et sera supprimé.** Les tools MCP sont servis directement par la webapp Baloo via la route HTTP `/api/mcp` (Streamable HTTP transport + OAuth 2.0).

Pour utiliser le MCP, voir : [doc/integrations.md](../doc/integrations.md) section "MCP HTTP".

Suppression effective : Phase 1 du pivot V1 ([doc/plans/2026-05-18-baloo-miroir-mcp-first-phase-1.md](../doc/plans/2026-05-18-baloo-miroir-mcp-first-phase-1.md)).
```

- [ ] **Step 2: Mettre à jour `CLAUDE.md`**

Retirer ou réécrire la section qui mentionne `compta/.env`, la génération de token, et le setup local. Remplacer par une référence au nouveau path HTTP.

Précisément : la section "Intégrations externes (MCPs)" parle de "`compta` (Baloo BDD prod) : MCP local qui appelle l'API webapp Next.js via HTTP". Remplacer par :

```markdown
- **MCP Baloo HTTP** : route `/api/mcp` de la webapp expose tous les tools (lecture/écriture BDD). Auth via OAuth 2.0 (voir `web/src/app/(app)/moi/connexions/`). Plus de setup local — l'utilisateur ajoute Baloo dans Claude Desktop via l'URL `https://baloo.benomite.com/api/mcp` et un login OAuth.
  - Si `vue_ensemble` ou autres outils MCP renvoient 401 → token expiré → user re-authentifie via la page `/moi/connexions`.
```

- [ ] **Step 3: Mettre à jour `doc/integrations.md`**

Repérer la section actuelle sur le MCP `compta` et la réécrire en cohérence avec Step 2 (référence à `/api/mcp` + flux OAuth, plus de `compta/.env`).

- [ ] **Step 4: Commit**

```bash
git add compta/README.md CLAUDE.md doc/integrations.md
git commit -m "doc: deprecation compta/ standalone, doc pointe sur /api/mcp HTTP"
```

---

## Task 4 : Supprimer `compta/`

**Pré-requis :** Task 2 (portage des tools) terminée et toutes les commits passent.

**Files:**
- Delete: `compta/` (tout le dossier)
- Modify: `doc/plans/2026-05-18-tools-portage-audit.md` (le supprimer aussi : son rôle est fini)
- Check: pas de référence à `compta/` ailleurs dans le code

- [ ] **Step 1: Vérifier qu'il ne reste aucune référence à `compta/`**

Run: `grep -rln "compta/" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git . 2>/dev/null`
Expected: aucun résultat dans le code source actif. Les `doc/decisions.md` ou `doc/plans/*.md` historiques peuvent en parler — c'est OK, c'est historique.

Si des références demeurent dans du code actif, les régler (probablement résolu par Task 3 mais peut rester des import erronés).

- [ ] **Step 2: Vérifier qu'aucun script `package.json` (web ou racine) ne pointe sur `compta/`**

Run: `grep -E '"[^"]*"\s*:\s*"[^"]*compta' package.json web/package.json 2>/dev/null`
Expected: aucun match.

- [ ] **Step 3: Supprimer `compta/`**

Run: `git rm -r compta/`

- [ ] **Step 4: Supprimer la note d'audit (rôle terminé)**

Run: `git rm doc/plans/2026-05-18-tools-portage-audit.md`

- [ ] **Step 5: Run la suite de tests pour vérifier que rien ne casse**

Run: `cd web && pnpm test`
Expected: PASS sur tous les tests.

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: suppression compta/ standalone (tools tous portés vers /api/mcp)"
```

---

## Task 5 : Migration statut enum `ecritures`

**Files:**
- Modify: `web/src/lib/db/business-schema.ts` (autour de la ligne 154, table `ecritures`)
- Test: `web/src/lib/db/__tests__/business-schema-status-migration.test.ts`

**Contexte :** la table `ecritures` a actuellement `status TEXT NOT NULL DEFAULT 'brouillon' CHECK(status IN ('brouillon', 'valide', 'saisie_comptaweb'))`. Le nouveau enum est `draft`, `pending_cw`, `pending_sync`, `mirror`, `divergent`. Le CHECK doit être retiré (selon CLAUDE.md "CHECK SQL à éviter"), la validation passe côté code.

**Mapping anciens → nouveaux :**
- `brouillon` → `draft`
- `valide` → `pending_sync` (validé localement mais pas encore confirmé miroir CW)
- `saisie_comptaweb` → `mirror`

- [ ] **Step 1: Écrire le test de migration**

Créer `web/src/lib/db/__tests__/business-schema-status-migration.test.ts` :

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { ensureBusinessSchema } from '../business-schema';

describe('ecritures.status migration', () => {
  let db: ReturnType<typeof createClient>;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    // Crée la table avec l'ancien schéma (CHECK + valeurs legacy)
    await db.execute(`
      CREATE TABLE ecritures (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        date TEXT NOT NULL,
        montant INTEGER NOT NULL,
        intitule TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'brouillon'
          CHECK(status IN ('brouillon', 'valide', 'saisie_comptaweb')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(`
      INSERT INTO ecritures (id, group_id, date, montant, intitule, status) VALUES
        ('a', 'g', '2026-01-01', 1000, 'brouillon-x', 'brouillon'),
        ('b', 'g', '2026-01-02', 2000, 'valide-x', 'valide'),
        ('c', 'g', '2026-01-03', 3000, 'cw-x', 'saisie_comptaweb')
    `);
  });

  it('retire le CHECK et migre les valeurs vers le nouvel enum', async () => {
    await ensureBusinessSchema(db);

    const rows = await db.execute('SELECT id, status FROM ecritures ORDER BY id');
    const byId = Object.fromEntries(rows.rows.map(r => [r.id as string, r.status as string]));
    expect(byId.a).toBe('draft');
    expect(byId.b).toBe('pending_sync');
    expect(byId.c).toBe('mirror');
  });

  it('autorise les nouvelles valeurs (pas de CHECK bloquant)', async () => {
    await ensureBusinessSchema(db);

    await db.execute(`
      INSERT INTO ecritures (id, group_id, date, montant, intitule, status)
        VALUES ('d', 'g', '2026-01-04', 4000, 'pending-cw', 'pending_cw')
    `);
    await db.execute(`
      INSERT INTO ecritures (id, group_id, date, montant, intitule, status)
        VALUES ('e', 'g', '2026-01-05', 5000, 'divergent', 'divergent')
    `);

    const rows = await db.execute('SELECT id FROM ecritures WHERE status IN (?, ?) ORDER BY id', ['pending_cw', 'divergent']);
    expect(rows.rows.map(r => r.id)).toEqual(['d', 'e']);
  });
});
```

(Note : adapter la signature `ensureBusinessSchema(db)` si la fonction n'accepte pas de DB en paramètre. Si elle utilise le client global, refacto léger nécessaire — voir Step 4. Alternativement, le test peut mocker le client.)

- [ ] **Step 2: Run test, attendu : FAIL**

Run: `cd web && pnpm test -- business-schema-status-migration`
Expected: FAIL (la migration n'existe pas encore).

- [ ] **Step 3: Implémenter la migration dans `business-schema.ts`**

Dans `web/src/lib/db/business-schema.ts`, ajouter (idéalement après la création de table `ecritures`) une migration idempotente, similaire au pattern utilisé pour le rôle user dans `auth/schema.ts` :

```typescript
// Migration statut enum ecritures (Phase 1 pivot miroir strict)
const ecrituresDef = await db.execute(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='ecritures'"
).then(r => r.rows[0]);

if (ecrituresDef?.sql && /CHECK\s*\(\s*status\s+IN\s*\([^)]*'brouillon'/i.test(ecrituresDef.sql as string)) {
  // 1. Recrée la table sans CHECK
  await db.execute(`
    CREATE TABLE ecritures_new (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      date TEXT NOT NULL,
      montant INTEGER NOT NULL,
      intitule TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      -- (copier ici TOUTES les autres colonnes de l'ancienne table — voir ci-dessous)
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // 2. Copie en remappant le statut
  await db.execute(`
    INSERT INTO ecritures_new (id, group_id, date, montant, intitule, status, created_at, updated_at /* + autres */)
    SELECT id, group_id, date, montant, intitule,
      CASE status
        WHEN 'brouillon' THEN 'draft'
        WHEN 'valide' THEN 'pending_sync'
        WHEN 'saisie_comptaweb' THEN 'mirror'
        ELSE status
      END AS status,
      created_at, updated_at /* + autres */
    FROM ecritures
  `);
  // 3. Swap
  await db.execute('DROP TABLE ecritures');
  await db.execute('ALTER TABLE ecritures_new RENAME TO ecritures');
  // 4. Re-créer index
  await db.execute('CREATE INDEX IF NOT EXISTS idx_ecritures_status ON ecritures(status)');
}
```

**IMPORTANT :** Avant d'exécuter cette migration en prod, lister TOUTES les colonnes actuelles de la table `ecritures` (cf. business-schema.ts) et les inclure dans `ecritures_new` et l'INSERT. Pas de perte de colonne. Pas de perte de FK.

- [ ] **Step 4: Run test, attendu : PASS**

Run: `cd web && pnpm test -- business-schema-status-migration`
Expected: PASS.

Si `ensureBusinessSchema` n'accepte pas de db en paramètre, faire un refacto léger : extraire la logique de migration ecritures en une fonction `migrateEcrituresStatus(db)` qui est appelée par `ensureBusinessSchema()` mais testable indépendamment avec un client `:memory:`.

- [ ] **Step 5: Vérifier que les autres tests passent**

Run: `cd web && pnpm test`
Expected: PASS sur tous.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/db/business-schema.ts web/src/lib/db/__tests__/business-schema-status-migration.test.ts
git commit -m "feat(db): migration statut enum ecritures (draft/pending_cw/pending_sync/mirror/divergent)"
```

---

## Task 6 : Adapter les queries lecture aux nouveaux statuts

**Files:**
- Modify: `web/src/lib/queries/ecritures.ts` (queries list/filter)
- Modify: `web/src/app/api/ecritures/route.ts` (endpoint GET)
- Modify: `web/src/lib/queries/inbox.ts` ou équivalent (drafts visibles)
- Test: `web/src/lib/queries/__tests__/ecritures.test.ts`

**Comportement attendu :**
- `/api/ecritures` (GET) et `/ecritures` (page) → ne retourne par défaut que `status = 'mirror'` (le miroir CW propre). Filtre opt-in pour voir aussi `divergent`.
- `/api/inbox/*` → expose les `draft`, `pending_cw`, `pending_sync` (les "en attente").

- [ ] **Step 1: Écrire le test des queries `listEcritures`**

```typescript
// web/src/lib/queries/__tests__/ecritures.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { listEcritures } from '../ecritures';
import { setupTestDb } from '../../../test-utils/db'; // créer si pas exist

describe('listEcritures', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb();
    await db.execute(`
      INSERT INTO ecritures (id, group_id, date, montant, intitule, status) VALUES
        ('m1', 'g1', '2026-01-01', 100, 'mirror-1', 'mirror'),
        ('d1', 'g1', '2026-01-02', 200, 'draft-1', 'draft'),
        ('p1', 'g1', '2026-01-03', 300, 'pending-1', 'pending_sync'),
        ('div1', 'g1', '2026-01-04', 400, 'divergent-1', 'divergent')
    `);
  });

  it('par défaut ne retourne que les écritures mirror', async () => {
    const items = await listEcritures(db, { group_id: 'g1' });
    expect(items.map(i => i.id).sort()).toEqual(['m1']);
  });

  it('avec includeDivergent=true, retourne aussi les divergent', async () => {
    const items = await listEcritures(db, { group_id: 'g1', includeDivergent: true });
    expect(items.map(i => i.id).sort()).toEqual(['div1', 'm1']);
  });
});
```

- [ ] **Step 2: Run test, attendu : FAIL**

Run: `cd web && pnpm test -- queries/__tests__/ecritures`
Expected: FAIL (signature `listEcritures` actuelle ne filtre pas par statut, ou `includeDivergent` n'existe pas).

- [ ] **Step 3: Modifier `listEcritures` dans `web/src/lib/queries/ecritures.ts`**

Localiser la fonction actuelle, ajouter le filtre statut :

```typescript
export async function listEcritures(db: DbClient, opts: {
  group_id: string;
  includeDivergent?: boolean;
  // ... autres opts existants
}) {
  const statuses = opts.includeDivergent ? ['mirror', 'divergent'] : ['mirror'];
  const placeholders = statuses.map(() => '?').join(',');
  const rows = await db.execute(
    `SELECT * FROM ecritures
     WHERE group_id = ? AND status IN (${placeholders})
     ORDER BY date DESC`,
    [opts.group_id, ...statuses],
  );
  return rows.rows.map(mapEcritureRow);
}
```

(Garder la signature ouverte aux autres filtres existants — date range, carte, etc.)

- [ ] **Step 4: Run test, attendu : PASS**

Run: `cd web && pnpm test -- queries/__tests__/ecritures`
Expected: PASS.

- [ ] **Step 5: Adapter `/api/ecritures` route GET**

S'assurer que le param query `?includeDivergent=1` est passé à `listEcritures`. Ne RIEN exposer des statuts intermédiaires (draft/pending_*) sur cet endpoint.

- [ ] **Step 6: Écrire/adapter le test inbox pour exposer les drafts**

Le fichier `web/src/lib/queries/inbox.ts` (ou les services `findSuggestionsForEcriture` cf. commit `dfd0048`) doit lister les drafts/pending. Vérifier le test existant et l'adapter si besoin pour les nouveaux statuts.

```typescript
// Pseudo-code à adapter au fichier réel
it('listOrphanEcritures retourne les drafts et pending', async () => {
  const items = await listOrphanEcritures(db, { group_id: 'g1' });
  // Les statuts attendus dans l'inbox = draft, pending_cw, pending_sync
  expect(items.map(i => i.status).sort()).toEqual(['draft', 'pending_cw', 'pending_sync']);
});
```

Implémenter la modif correspondante dans `listOrphanEcritures` : `WHERE status IN ('draft', 'pending_cw', 'pending_sync')`.

- [ ] **Step 7: Run tous les tests**

Run: `cd web && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/queries/ecritures.ts web/src/lib/queries/inbox.ts web/src/app/api/ecritures/route.ts web/src/lib/queries/__tests__/ecritures.test.ts
git commit -m "feat(queries): /ecritures filtre mirror par défaut, inbox expose drafts/pending"
```

---

## Task 7 : Flux création écriture côté API (pilote Comptaweb)

**Files:**
- Modify: `web/src/app/api/ecritures/route.ts` (POST handler)
- Modify: `web/src/lib/actions/ecritures.ts` ou créer `web/src/lib/services/ecritures-create.ts`
- Read: `web/src/lib/comptaweb/ecritures-write.ts` (function `createEcriture` existante)
- Test: `web/src/lib/services/__tests__/ecritures-create.test.ts`

**Comportement attendu (rappel spec) :**
```
POST /api/ecritures {payload}
  → INSERT en BDD avec status='pending_cw' (snapshot du payload, pas encore confirmé CW)
  → Appel scraper CW createEcriture(payload)
  → Succès : UPDATE status='pending_sync', store cw_numero_piece (la sync incrémentale promouvra plus tard en 'mirror')
  → Échec  : UPDATE status='draft', retour erreur au caller (l'utilisateur peut copier-coller manuellement ou réessayer)
```

Cette task crée la fonction de service + l'utilise depuis la route POST. La sync incrémentale qui promeut `pending_sync` → `mirror` est **Phase 2** — pour cette task, on s'arrête au `pending_sync` après écriture CW.

- [ ] **Step 1: Écrire le test du service**

```typescript
// web/src/lib/services/__tests__/ecritures-create.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEcritureAndPushToCw } from '../ecritures-create';
import { setupTestDb } from '../../../test-utils/db';

describe('createEcritureAndPushToCw', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  it('succès scraping : statut passe à pending_sync avec cw_numero_piece', async () => {
    const scraperMock = vi.fn().mockResolvedValue({ numero_piece: 'CW-2026-001' });
    const result = await createEcritureAndPushToCw(db, {
      payload: { date: '2026-05-18', montant: 5000, intitule: 'Test' },
      group_id: 'g1',
      cwScraper: scraperMock,
    });

    expect(scraperMock).toHaveBeenCalledOnce();
    expect(result.status).toBe('pending_sync');
    expect(result.cw_numero_piece).toBe('CW-2026-001');

    const row = await db.execute('SELECT status, cw_numero_piece FROM ecritures WHERE id = ?', [result.id]);
    expect(row.rows[0].status).toBe('pending_sync');
    expect(row.rows[0].cw_numero_piece).toBe('CW-2026-001');
  });

  it('échec scraping : statut reste draft, exception remontée au caller', async () => {
    const scraperMock = vi.fn().mockRejectedValue(new Error('CW down'));
    await expect(
      createEcritureAndPushToCw(db, {
        payload: { date: '2026-05-18', montant: 5000, intitule: 'Test' },
        group_id: 'g1',
        cwScraper: scraperMock,
      }),
    ).rejects.toThrow('CW down');

    const rows = await db.execute('SELECT status FROM ecritures');
    expect(rows.rows[0].status).toBe('draft');
  });
});
```

- [ ] **Step 2: Run test, attendu : FAIL**

Run: `cd web && pnpm test -- ecritures-create`
Expected: FAIL ("module not found" ou équivalent).

- [ ] **Step 3: Implémenter `createEcritureAndPushToCw`**

Créer `web/src/lib/services/ecritures-create.ts` :

```typescript
import type { DbClient } from '../db/types';
import { createEcriture as cwCreateEcriture } from '../comptaweb/ecritures-write';
import { loadConfig } from '../comptaweb/auth';
import { randomUUID } from 'crypto';

type EcriturePayload = {
  date: string;
  montant: number;
  intitule: string;
  // ... autres champs (carte_id, unite_id, etc.) — adapter au schéma réel
};

type CwScraper = (config: unknown, payload: EcriturePayload) => Promise<{ numero_piece: string }>;

export async function createEcritureAndPushToCw(
  db: DbClient,
  opts: {
    payload: EcriturePayload;
    group_id: string;
    cwScraper?: CwScraper; // injectable pour les tests
  },
) {
  const id = randomUUID();
  const scraper = opts.cwScraper ?? cwCreateEcriture;

  // 1. INSERT en pending_cw
  await db.execute(
    `INSERT INTO ecritures (id, group_id, date, montant, intitule, status)
     VALUES (?, ?, ?, ?, ?, 'pending_cw')`,
    [id, opts.group_id, opts.payload.date, opts.payload.montant, opts.payload.intitule],
  );

  // 2. Push CW
  try {
    const config = await loadConfig();
    const { numero_piece } = await scraper(config, opts.payload);

    // 3. UPDATE en pending_sync
    await db.execute(
      `UPDATE ecritures SET status = 'pending_sync', cw_numero_piece = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [numero_piece, id],
    );

    return { id, status: 'pending_sync' as const, cw_numero_piece: numero_piece };
  } catch (err) {
    // Fallback: rétrograde en draft (l'user pourra copier-coller manuellement)
    await db.execute(
      `UPDATE ecritures SET status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id],
    );
    throw err;
  }
}
```

- [ ] **Step 4: Run test, attendu : PASS**

Run: `cd web && pnpm test -- ecritures-create`
Expected: PASS (les deux tests).

- [ ] **Step 5: Brancher la route POST `/api/ecritures` sur ce service**

Dans `web/src/app/api/ecritures/route.ts` (POST handler) :

```typescript
import { createEcritureAndPushToCw } from '@/lib/services/ecritures-create';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/session'; // ou équivalent existant

export async function POST(req: Request) {
  const { group_id } = await requireSession(req); // adapte au pattern existant
  const payload = await req.json();
  try {
    const result = await createEcritureAndPushToCw(getDb(), { payload, group_id });
    return Response.json({ ok: true, ecriture: result });
  } catch (err) {
    return Response.json(
      { ok: false, error: 'cw_write_failed', message: (err as Error).message, fallback_status: 'draft' },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 6: Test d'intégration de la route POST (optionnel mais recommandé)**

Si un harness de test de route existe (cf. patterns existants), ajouter un test qui POST `/api/ecritures` et vérifie le statut.

- [ ] **Step 7: Run tous les tests**

Run: `cd web && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/services/ecritures-create.ts web/src/lib/services/__tests__/ecritures-create.test.ts web/src/app/api/ecritures/route.ts
git commit -m "feat(api): POST /api/ecritures pilote Comptaweb (draft -> pending_cw -> pending_sync ou draft)"
```

---

## Task 8 : Refonte UI saisie écriture (interface Comptaweb assistée)

**Files:**
- Modify: `web/src/app/(app)/ecritures/nouveau/page.tsx`
- Modify: `web/src/app/(app)/ecritures/[id]/page.tsx` (édition)
- Modify: `web/src/components/ecritures/ecriture-form.tsx`
- Create: `web/src/components/ecritures/cw-assist-actions.tsx` (composant des 3 boutons)
- Test: `web/src/components/ecritures/__tests__/cw-assist-actions.test.tsx`

**Comportement attendu :**
- Le formulaire prépare un payload structuré
- 3 boutons :
  - **"Faire dans Comptaweb pour moi"** → appelle `POST /api/ecritures` (qui pilote CW via Task 7) ; affiche pending → success/failure
  - **"Ouvrir Comptaweb pré-rempli"** → ouvre `https://compta.sgdf.fr/?...query...` dans un nouvel onglet (si deep-link possible — sinon n'afficher pas ce bouton)
  - **"Tout copier"** → met dans le clipboard les champs préparés en texte lisible, puis l'utilisateur va dans CW et colle manuellement
- Bandeau d'explication clair en haut : "Cette page **prépare** une saisie dans Comptaweb. Baloo n'écrit rien en local."

- [ ] **Step 1: Écrire le test du composant `CwAssistActions`**

```typescript
// web/src/components/ecritures/__tests__/cw-assist-actions.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CwAssistActions } from '../cw-assist-actions';

describe('CwAssistActions', () => {
  const payload = { date: '2026-05-18', montant: 5000, intitule: 'Test' };

  it('rend les 3 boutons quand deep link est disponible', () => {
    render(<CwAssistActions payload={payload} deepLinkUrl="https://cw.example/x" />);
    expect(screen.getByRole('button', { name: /faire dans comptaweb/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ouvrir comptaweb pré-rempli/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tout copier/i })).toBeInTheDocument();
  });

  it('rend 2 boutons quand deep link absent', () => {
    render(<CwAssistActions payload={payload} />);
    expect(screen.queryByRole('link', { name: /ouvrir comptaweb/i })).not.toBeInTheDocument();
  });

  it('clic sur "Faire dans CW pour moi" appelle onSubmitToCw avec le payload', () => {
    const onSubmit = vi.fn();
    render(<CwAssistActions payload={payload} onSubmitToCw={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /faire dans comptaweb/i }));
    expect(onSubmit).toHaveBeenCalledWith(payload);
  });

  it('clic sur "Tout copier" copie le payload formaté dans le clipboard', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CwAssistActions payload={payload} />);
    fireEvent.click(screen.getByRole('button', { name: /tout copier/i }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain('Test'); // intitule présent
    expect(writeText.mock.calls[0][0]).toContain('50,00'); // montant formaté
  });
});
```

(Si `@testing-library/react` n'est pas installé : `cd web && pnpm add -D @testing-library/react @testing-library/jest-dom jsdom`.)

- [ ] **Step 2: Run test, attendu : FAIL**

Run: `cd web && pnpm test -- cw-assist-actions`
Expected: FAIL (composant n'existe pas).

- [ ] **Step 3: Implémenter `CwAssistActions`**

Créer `web/src/components/ecritures/cw-assist-actions.tsx` :

```tsx
'use client';

type Payload = {
  date: string;
  montant: number;
  intitule: string;
  // ... autres champs réels
};

type Props = {
  payload: Payload;
  deepLinkUrl?: string;
  onSubmitToCw?: (payload: Payload) => void | Promise<void>;
};

function formatPayloadForClipboard(p: Payload): string {
  const montantFr = (p.montant / 100).toFixed(2).replace('.', ',');
  return [
    `Date    : ${p.date}`,
    `Montant : ${montantFr} €`,
    `Libellé : ${p.intitule}`,
  ].join('\n');
}

export function CwAssistActions({ payload, deepLinkUrl, onSubmitToCw }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onSubmitToCw?.(payload)}
        className="btn-primary"
      >
        Faire dans Comptaweb pour moi
      </button>

      {deepLinkUrl && (
        <a
          href={deepLinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary"
        >
          Ouvrir Comptaweb pré-rempli
        </a>
      )}

      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(formatPayloadForClipboard(payload))}
        className="btn-secondary"
      >
        Tout copier
      </button>
    </div>
  );
}
```

(Adapter les classes Tailwind/utilitaires aux conventions design du projet — voir `web/src/components/shared/`.)

- [ ] **Step 4: Run test, attendu : PASS**

Run: `cd web && pnpm test -- cw-assist-actions`
Expected: PASS.

- [ ] **Step 5: Refondre `/ecritures/nouveau/page.tsx`**

Remplacer le contenu du formulaire actuel par :
1. Un bandeau d'explication ("Cette page prépare une saisie dans Comptaweb...")
2. Le formulaire de saisie (réutiliser `ecriture-form.tsx` si pertinent, en mode "préparation" sans bouton submit)
3. `<CwAssistActions payload={...} onSubmitToCw={...} />`
4. Le handler `onSubmitToCw` appelle `POST /api/ecritures` (Task 7), montre un état `pending` → `pending_sync` → "écriture envoyée à Comptaweb, sera visible après le prochain sync" OU `error` → "échec, l'écriture est restée en draft, tu peux copier-coller manuellement"

- [ ] **Step 6: Refondre `/ecritures/[id]/page.tsx` (édition)**

Même pattern : la page d'édition ne modifie plus localement. Elle expose un payload de modification + `<CwAssistActions>` adapté. Si la modif d'écriture CW n'a pas de scraping write (vérifier dans `web/src/lib/comptaweb/`), seul "Tout copier" est dispo, avec mention claire.

- [ ] **Step 7: Tester manuellement le flux**

Lancer le dev server : `cd web && pnpm dev`
- Aller sur `/ecritures/nouveau`
- Remplir un payload de test
- Cliquer "Tout copier" → vérifier que le clipboard contient le texte
- Cliquer "Faire dans Comptaweb pour moi" (avec un CW de test si possible — sinon vérifier l'appel API via Network tab)

- [ ] **Step 8: Commit**

```bash
git add web/src/components/ecritures/cw-assist-actions.tsx web/src/components/ecritures/__tests__/cw-assist-actions.test.tsx web/src/app/\(app\)/ecritures/nouveau/page.tsx web/src/app/\(app\)/ecritures/\[id\]/page.tsx
git commit -m "feat(ecritures): pages saisie/edition deviennent des interfaces Comptaweb assistées"
```

---

## Task 9 : Refonte UI mouvements caisse (Tout copier)

**Files:**
- Modify: `web/src/app/(app)/caisse/...` (page de saisie de mouvement caisse — localiser le chemin exact)
- Reuse: `web/src/components/ecritures/cw-assist-actions.tsx` (Task 8)

**Comportement attendu :** identique à Task 8 mais avec UNIQUEMENT le bouton "Tout copier" disponible (car aucun scraping write pour la caisse). Bandeau d'explication adapté : "La caisse Comptaweb ne supporte pas l'écriture automatique. Utilise 'Tout copier' puis saisis dans Comptaweb."

- [ ] **Step 1: Localiser la page caisse**

Run: `find web/src/app -path "*caisse*" -name "*.tsx" 2>/dev/null`
Expected: trouver la(les) page(s) de saisie de mouvement.

- [ ] **Step 2: Refondre la page de saisie**

Suivre la même structure que `/ecritures/nouveau` (Task 8 Step 5), mais :
- N'afficher que "Tout copier" dans `<CwAssistActions>` (props : `onSubmitToCw={undefined}`, `deepLinkUrl={undefined}`)
- Bandeau d'explication adapté

- [ ] **Step 3: Tester manuellement**

`pnpm dev`, naviguer sur la page caisse, vérifier que le formulaire prépare le bon contenu pour le clipboard.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(app\)/caisse/
git commit -m "feat(caisse): page mouvement devient assistant copier-coller Comptaweb"
```

---

## Vérification finale Phase 1

- [ ] **Step 1: Run la suite complète de tests**

Run: `cd web && pnpm test`
Expected: PASS sur tous.

- [ ] **Step 2: Build de prod (vérifier qu'aucune référence à `compta/` n'a été oubliée)**

Run: `cd web && pnpm build`
Expected: PASS sans erreur ni warning lié à `compta/`.

- [ ] **Step 3: Update mémoire Claude Code (hors repo)**

Ajouter une entrée projet dans la mémoire Claude Code de l'utilisateur (chemin `~/.claude/projects/.../memory/MEMORY.md`) :

```markdown
- [Phase 1 pivot livrée](project_phase_1_pivot_livree.md) — compta/ supprimé, statut ecritures migré, pages saisie devenues interfaces Comptaweb assistées
```

Et créer le fichier mémoire correspondant. Cette étape n'est pas committée dans le repo Baloo : la mémoire vit hors du projet.

---

## Notes pour l'exécutant

- **Branche** : faire la Phase 1 sur une branche dédiée, par exemple `feat/phase-1-miroir-strict`. PR séparée pour validation avant merge dans `main`.
- **Pas de push avant accord** (cf. mémoire utilisateur).
- **Pas de DELETE** sur les tables BDD existantes : la migration statut utilise CREATE/INSERT/DROP/RENAME sur la table `ecritures` qui est compatible avec le pattern UPSERT (les données ne sont pas perdues, juste re-typées).
- **Validation manuelle après chaque Task UI** (8 et 9) : tester en dev avec un payload réel avant de commit.
- **Phase 2 dépend de cette phase** : tant que le statut enum n'est pas en place, le mécanisme de sync (qui promeut `pending_sync` → `mirror`) n'a pas de sens. Ne pas démarrer la Phase 2 avant que cette Phase 1 soit mergée.
