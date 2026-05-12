# MCP trésorier — Inbox justifs + Cleanup Comptaweb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Exposer côté MCP les capacités d'inbox de justificatifs (orphelins, suggestions, link, auto-match, upload PDF depuis chemin local) et de cleanup post-import Comptaweb (dedup, transferts internes, orphelins de ventilation), pour permettre au trésorier de fermer 90 % de ses tâches quotidiennes depuis Claude Desktop sans ouvrir la webapp.

**Architecture :** Logique métier intacte dans `web/src/lib/services/` (services existants à exposer, pas à modifier). Nouvelles routes API thin sous `web/src/app/api/inbox/`, `web/src/app/api/comptaweb/cleanup/`, `web/src/app/api/justificatifs` (POST manquant) et `web/src/app/api/depots/upload`. Nouveau fichier MCP `compta/src/tools/inbox.ts` et ajouts dans `compta/src/tools/comptaweb.ts`. Pattern preview/apply pour les cleanups : `apply` exige un tableau `ids` venant d'un `preview` précédent.

**Tech Stack :** Next 16 (App Router, route handlers Node runtime), libsql/Turso, zod, vitest. Côté MCP : `@modelcontextprotocol/sdk` stdio transport, `FormData` natif Node, `fetch`. Aucune nouvelle dépendance.

**Spec source :** [`doc/specs/2026-05-12-mcp-tresorier-inbox-cleanup-design.md`](../specs/2026-05-12-mcp-tresorier-inbox-cleanup-design.md)

**Tests :** Suit la convention projet — modules purs testés en vitest, routes API et tools MCP vérifiés manuellement (curl + Claude Desktop). Pas de tests d'intégration HTTP automatisés. Aucun module pur nouveau n'apparaît dans ce plan (toutes les routes sont des wrappers thin de services existants).

---

## File Structure

**Créés :**
- `web/src/app/api/justificatifs/route.ts` — handler `POST` (upload + attache à entité existante)
- `web/src/app/api/depots/upload/route.ts` — handler `POST` multipart (crée dépôt orphelin avec fichier, optionnellement attaché à une écriture)
- `web/src/app/api/inbox/orphan-ecritures/route.ts` — handler `GET`
- `web/src/app/api/inbox/orphan-justifs/route.ts` — handler `GET`
- `web/src/app/api/inbox/suggestions/route.ts` — handler `GET`
- `web/src/app/api/inbox/link/route.ts` — handler `POST`
- `web/src/app/api/inbox/auto-match/route.ts` — handler `POST`
- `web/src/app/api/comptaweb/cleanup/dedup/route.ts` — handler `POST` (preview/apply)
- `web/src/app/api/comptaweb/cleanup/transferts/route.ts` — handler `POST` (preview/apply)
- `web/src/app/api/comptaweb/cleanup/orphelins/route.ts` — handler `POST` (preview/apply)
- `compta/src/tools/inbox.ts` — 5 tools MCP (list orphelins, suggestions, link, auto-match)
- `compta/src/tools/upload-orphan.ts` — 1 tool MCP `upload_justificatif_orphan` (créer dépôt orphelin avec fichier local)

**Modifiés :**
- `compta/src/tools/comptaweb.ts` — ajout 3 tools `cw_cleanup_dedup` / `cw_cleanup_transferts` / `cw_cleanup_orphelins`
- `compta/src/tools/justificatifs.ts` — corriger `attach_justificatif` pour qu'il fonctionne avec la nouvelle route `POST /api/justificatifs`
- `compta/src/index.ts` — registrer `registerInboxTools` et `registerUploadOrphanTool`

**Aucun changement de schéma BDD.** Tous les services et tables utilisés existent déjà.

---

## Phase A — Routes API webapp (lecture/écriture inbox)

### Task 1 — Routes `GET /api/inbox/orphan-ecritures` et `GET /api/inbox/orphan-justifs`

**Files :**
- Create: `web/src/app/api/inbox/orphan-ecritures/route.ts`
- Create: `web/src/app/api/inbox/orphan-justifs/route.ts`
- Read for context: `web/src/lib/queries/inbox.ts` (signatures `listInboxItems`, `InboxOptions`)
- Read for context: `web/src/app/api/abandons/route.ts` (pattern auth + zod)

- [ ] **Step 1 — Créer le handler orphan-ecritures**

Créer `web/src/app/api/inbox/orphan-ecritures/route.ts` :

```ts
import { z } from 'zod';
import { listInboxItems, INBOX_PERIODS, type InboxPeriod } from '@/lib/queries/inbox';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const querySchema = z
  .object({
    period: z.enum(INBOX_PERIODS).optional(),
    recettes: z
      .union([z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
      .optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  const period: InboxPeriod = parsed.data.period ?? '90j';
  const includeRecettes = parsed.data.recettes === '1' || parsed.data.recettes === 'true';

  const data = await listInboxItems(groupId, { period, includeRecettes });

  return Response.json({
    period,
    include_recettes: includeRecettes,
    count: data.ecritures.length,
    truncated: data.truncated ?? false,
    ecritures: data.ecritures,
  });
}
```

Si `listInboxItems` ne retourne pas exactement `{ ecritures, justifs, truncated }`, adapter le mapping. Lire `queries/inbox.ts` lignes 90–182 pour confirmer la shape.

- [ ] **Step 2 — Créer le handler orphan-justifs**

Créer `web/src/app/api/inbox/orphan-justifs/route.ts` :

```ts
import { listInboxItems } from '@/lib/queries/inbox';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  // On utilise period='tout' parce que les justifs orphelins n'ont pas
  // de filtre période dans la webapp (cf. spec).
  const data = await listInboxItems(groupId, { period: 'tout', includeRecettes: true });

  return Response.json({
    count: data.justifs.length,
    depots: data.justifs,
  });
}
```

- [ ] **Step 3 — Test manuel curl**

Démarrer le dev server :

```bash
cd web && pnpm dev
```

Générer (si pas déjà fait) un token API pour l'utilisateur courant :

```bash
cd web && pnpm exec tsx scripts/generate-api-token.ts <ton-email> --name "test-mcp-inbox"
```

Tester chaque route :

```bash
curl -H "Authorization: Bearer $BALOO_API_TOKEN" "http://localhost:3000/api/inbox/orphan-ecritures?period=90j" | jq
curl -H "Authorization: Bearer $BALOO_API_TOKEN" "http://localhost:3000/api/inbox/orphan-ecritures?period=90j&recettes=1" | jq
curl -H "Authorization: Bearer $BALOO_API_TOKEN" "http://localhost:3000/api/inbox/orphan-justifs" | jq
```

Attendu : JSON valide, `count` cohérent avec `/inbox` côté webapp, 401 si token absent.

- [ ] **Step 4 — Commit**

```bash
cd <repo-root>
git add web/src/app/api/inbox/orphan-ecritures/route.ts web/src/app/api/inbox/orphan-justifs/route.ts
git commit -m "feat(api): routes GET /api/inbox/orphan-ecritures et orphan-justifs

Expose les listes d'orphelins inbox via API pour permettre au MCP
trésorier de pilotter le matching écritures<->justifs depuis Claude.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2 — Route `GET /api/inbox/suggestions`

**Files :**
- Create: `web/src/app/api/inbox/suggestions/route.ts`
- Read for context: `web/src/lib/queries/inbox.ts` (chercher la fonction de suggestions lenient — probablement `listInboxItems` retourne déjà `suggestions: InboxSuggestion[]` par écriture/justif)

- [ ] **Step 1 — Lire le code des suggestions existantes**

Lire `web/src/lib/queries/inbox.ts` lignes 50–80 (struct `InboxSuggestion`) et lignes 90–182 (`listInboxItems`). Identifier :
- Existe-t-il une fonction `findSuggestionsForEcriture(groupId, ecritureId)` ou `findSuggestionsForDepot(groupId, depotId)` exportable ?
- Sinon, les suggestions sont-elles pré-calculées dans `InboxData` par écriture et par justif ? Auquel cas extraire via filtrage.

Si aucune fonction dédiée n'existe :
- Soit ajouter dans `queries/inbox.ts` deux helpers `findSuggestionsForEcriture(groupId, ecritureId)` et `findSuggestionsForDepot(groupId, depotId)` qui réutilisent la logique lenient existante.
- Soit appeler `listInboxItems` puis filtrer le résultat dans la route (acceptable si la liste est petite ; à privilégier sinon pour ne pas dégrader).

Décision retenue (à appliquer step 2) : extraire deux helpers dans `queries/inbox.ts` pour ne pas re-calculer toute l'inbox à chaque suggestion.

- [ ] **Step 2 — Ajouter helpers `findSuggestionsForEcriture` / `findSuggestionsForDepot` dans `queries/inbox.ts`**

Repérer dans `queries/inbox.ts` la portion qui calcule les suggestions (probablement une boucle interne à `listInboxItems` qui appelle un service ou fait une query SQL `WHERE ABS(amount - ?) <= ? AND ABS(julianday(date) - julianday(?)) <= ?`). Extraire en deux fonctions exportées dont la signature :

```ts
export async function findSuggestionsForEcriture(
  groupId: string,
  ecritureId: string,
): Promise<InboxSuggestion[]> { ... }

export async function findSuggestionsForDepot(
  groupId: string,
  depotId: string,
): Promise<InboxSuggestion[]> { ... }
```

Si la fonction `listInboxItems` n'utilise pas une telle factorisation et fait tout en une grosse query, alors créer ces deux nouvelles fonctions à partir du même SQL ciblé sur 1 entité. Le but est de ne pas modifier le comportement de `listInboxItems` (toute la page `/inbox` en dépend).

- [ ] **Step 3 — Créer le handler de route**

Créer `web/src/app/api/inbox/suggestions/route.ts` :

```ts
import { z } from 'zod';
import { findSuggestionsForEcriture, findSuggestionsForDepot } from '@/lib/queries/inbox';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const querySchema = z
  .object({
    ecriture_id: z.string().optional(),
    depot_id: z.string().optional(),
  })
  .strict()
  .refine(
    (v) => (!!v.ecriture_id) !== (!!v.depot_id),
    { message: 'Fournir exactement un de ecriture_id ou depot_id.' },
  );

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  if (parsed.data.ecriture_id) {
    const matches = await findSuggestionsForEcriture(groupId, parsed.data.ecriture_id);
    return Response.json({ ecriture_id: parsed.data.ecriture_id, matches });
  }
  const matches = await findSuggestionsForDepot(groupId, parsed.data.depot_id!);
  return Response.json({ depot_id: parsed.data.depot_id, matches });
}
```

- [ ] **Step 4 — Test manuel curl**

Choisir un `ecriture_id` orphelin connu (issu de l'appel précédent à `/api/inbox/orphan-ecritures`). Tester :

```bash
ECR=ec_xxx  # remplacer par un id réel
curl -H "Authorization: Bearer $BALOO_API_TOKEN" "http://localhost:3000/api/inbox/suggestions?ecriture_id=$ECR" | jq
```

Attendu : `{ ecriture_id, matches: [...] }`, où chaque match a au moins `depot_id` + un score ou delta.

Tester aussi le refus `400` quand on passe les deux ou aucun :

```bash
curl -H "Authorization: Bearer $BALOO_API_TOKEN" "http://localhost:3000/api/inbox/suggestions" -i
curl -H "Authorization: Bearer $BALOO_API_TOKEN" "http://localhost:3000/api/inbox/suggestions?ecriture_id=a&depot_id=b" -i
```

Attendu : `400 Paramètres invalides.`

- [ ] **Step 5 — Commit**

```bash
git add web/src/lib/queries/inbox.ts web/src/app/api/inbox/suggestions/route.ts
git commit -m "feat(api): GET /api/inbox/suggestions

Expose les suggestions lenient (montant ±2%, date ±3j) pour une
écriture ou un dépôt orphelin. Extrait deux helpers dédiés dans
queries/inbox.ts pour éviter de recalculer toute l'inbox à chaque
appel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3 — Route `POST /api/inbox/link`

**Files :**
- Create: `web/src/app/api/inbox/link/route.ts`
- Read for context: `web/src/lib/services/depots.ts:228` (`attachDepotToEcriture`)

- [ ] **Step 1 — Confirmer la signature de `attachDepotToEcriture`**

Lire `web/src/lib/services/depots.ts` autour de la ligne 228. Confirmer la signature : `attachDepotToEcriture(ctx: { groupId }, depotId, ecritureId)` retourne quoi ? On suppose `Promise<{ justificatifId, ... }>` ou `Promise<void>`. Adapter le step 2 en conséquence.

- [ ] **Step 2 — Créer le handler**

Créer `web/src/app/api/inbox/link/route.ts` :

```ts
import { z } from 'zod';
import { attachDepotToEcriture } from '@/lib/services/depots';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const bodySchema = z
  .object({
    ecriture_id: z.string().min(1),
    depot_id: z.string().min(1),
  })
  .strict();

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const parsed = await parseJsonBody(request, bodySchema);
  if ('error' in parsed) return parsed.error;

  try {
    const result = await attachDepotToEcriture(
      { groupId },
      parsed.data.depot_id,
      parsed.data.ecriture_id,
    );
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue.';
    return jsonError(msg, 400);
  }
}
```

Si `attachDepotToEcriture` retourne `void`, remplacer la ligne `return Response.json({ ok: true, ...result }, ...)` par `return Response.json({ ok: true }, { status: 201 })`.

- [ ] **Step 3 — Test manuel curl**

Préparer un cas : un `ecriture_id` orphelin + un `depot_id` orphelin (issus des routes Task 1). Lancer :

```bash
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"ecriture_id":"ec_xxx","depot_id":"dep_yyy"}' \
  http://localhost:3000/api/inbox/link | jq
```

Attendu : `{ ok: true, ... }`. Re-tester l'écriture via `/api/inbox/orphan-ecritures` : elle ne doit plus apparaître.

Tester l'erreur (deux liens consécutifs sur le même dépôt) : second appel doit retourner `400` (déjà rattaché).

- [ ] **Step 4 — Commit**

```bash
git add web/src/app/api/inbox/link/route.ts
git commit -m "feat(api): POST /api/inbox/link

Wrap attachDepotToEcriture pour permettre au MCP de lier une écriture
et un dépôt orphelin depuis Claude. Erreurs métier renvoyées en 400.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4 — Route `POST /api/inbox/auto-match`

**Files :**
- Create: `web/src/app/api/inbox/auto-match/route.ts`
- Read for context: `web/src/lib/services/inbox-auto.ts` (`applyAutoLinks`)

- [ ] **Step 1 — Créer le handler**

Créer `web/src/app/api/inbox/auto-match/route.ts` :

```ts
import { applyAutoLinks } from '@/lib/services/inbox-auto';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const result = await applyAutoLinks(groupId);
  return Response.json({
    linked: result.pairs,
    rejected_ambiguous: [],
  });
}
```

Note : le service `applyAutoLinks` ne retourne pas (aujourd'hui) la liste des paires ambiguës qu'il a sautées. Pour la version V1 de la route on retourne `rejected_ambiguous: []` (fidèle au contrat actuel). Si tu veux instrumenter `applyAutoLinks` pour qu'il expose les ambiguïtés, c'est un add-on futur (pas dans ce lot).

- [ ] **Step 2 — Test manuel curl**

```bash
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" http://localhost:3000/api/inbox/auto-match | jq
```

Attendu : `{ linked: [{ ecritureId, depotId }], rejected_ambiguous: [] }`.

Idempotent : re-tester immédiatement, `linked` doit être vide (rien de nouveau à lier).

- [ ] **Step 3 — Commit**

```bash
git add web/src/app/api/inbox/auto-match/route.ts
git commit -m "feat(api): POST /api/inbox/auto-match

Wrap applyAutoLinks pour déclencher le matching strict depuis Claude.
Idempotent (rejoue sans effet si rien à lier).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Routes API webapp (upload)

### Task 5 — Route `POST /api/justificatifs` (upload + attach à entité existante)

Le tool MCP `attach_justificatif` existant appelle déjà `POST /api/justificatifs`, mais cette route n'existe pas — il faut la créer pour fixer le tool.

**Files :**
- Create: `web/src/app/api/justificatifs/route.ts`
- Read for context: `web/src/lib/actions/justificatifs.ts:7` (`uploadJustificatif` server action — la logique à reproduire)
- Read for context: `web/src/lib/services/justificatifs.ts` (le service sous-jacent)

- [ ] **Step 1 — Identifier le service d'upload**

Lire `web/src/lib/actions/justificatifs.ts` complet. Identifier la fonction service appelée derrière (probablement `createJustificatif({ entityType, entityId, filename, content, mime_type, groupId })` dans `lib/services/justificatifs.ts`). Note sa signature.

Si la logique est entièrement dans l'action (pas extraite en service pur), refactorer en extrayant un service `createJustificatif(ctx, input)` dans `web/src/lib/services/justificatifs.ts`. Garder l'action `uploadJustificatif(formData)` comme thin wrapper.

- [ ] **Step 2 — Créer le handler de route**

Créer `web/src/app/api/justificatifs/route.ts` :

```ts
import { z } from 'zod';
import { createJustificatif } from '@/lib/services/justificatifs';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const ENTITY_TYPES = ['ecriture', 'remboursement', 'abandon', 'depot', 'mouvement'] as const;

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('multipart/form-data attendu.', 415);
  }

  const form = await request.formData();
  const entityType = form.get('entity_type');
  const entityId = form.get('entity_id');
  const file = form.get('file');

  const validation = z
    .object({
      entity_type: z.enum(ENTITY_TYPES),
      entity_id: z.string().min(1),
    })
    .safeParse({ entity_type: entityType, entity_id: entityId });

  if (!validation.success) return jsonError('Paramètres invalides.', 400);
  if (!(file instanceof File)) return jsonError('Fichier requis.', 400);

  const buf = Buffer.from(await file.arrayBuffer());

  const created = await createJustificatif(
    { groupId },
    {
      entityType: validation.data.entity_type,
      entityId: validation.data.entity_id,
      filename: file.name,
      content: buf,
      mime_type: file.type || 'application/octet-stream',
    },
  );

  return Response.json(created, { status: 201 });
}
```

Si la signature de `createJustificatif` diffère (par ex. prend `content` en `Uint8Array` au lieu de `Buffer`, ou les clés sont `entity_type` en snake_case), adapter.

- [ ] **Step 3 — Test manuel curl**

Préparer un fichier PDF de test (n'importe quel petit PDF dans `inbox/`). Choisir une `ecriture_id` (de préférence en brouillon, sans justif).

```bash
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" \
  -F "entity_type=ecriture" \
  -F "entity_id=ec_xxx" \
  -F "file=@inbox/test.pdf" \
  http://localhost:3000/api/justificatifs | jq
```

Attendu : `201` avec la justif créée (id, file_path, mime_type). Côté webapp `/ecritures/<id>` : le PDF doit apparaître dans l'onglet "Justificatifs".

- [ ] **Step 4 — Commit**

```bash
git add web/src/app/api/justificatifs/route.ts web/src/lib/services/justificatifs.ts
git commit -m "feat(api): POST /api/justificatifs (upload + attach)

Fixe l'appel manquant utilisé par le tool MCP attach_justificatif.
Réutilise le service createJustificatif (extrait de l'action
uploadJustificatif si nécessaire).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6 — Route `POST /api/depots/upload` (créer dépôt orphelin avec fichier)

**Files :**
- Create: `web/src/app/api/depots/upload/route.ts`
- Read for context: `web/src/lib/services/depots.ts:95` (`createDepot`)
- Read for context: `web/src/lib/services/depots.ts:228` (`attachDepotToEcriture`)

- [ ] **Step 1 — Lire la signature `createDepot`**

Lire `web/src/lib/services/depots.ts` autour des lignes 79-138 pour récupérer la shape de `CreateDepotInput` et de la valeur retournée. On s'attend à au moins :

```ts
interface CreateDepotInput {
  title: string;
  montant_estime_cents?: number | null;
  date_estimee?: string | null;
  file: { filename: string; content: Buffer | Uint8Array; mime_type: string };
}
```

Si les noms diffèrent (par ex. `titre` au lieu de `title`), s'aligner.

- [ ] **Step 2 — Créer le handler de route**

Créer `web/src/app/api/depots/upload/route.ts` :

```ts
import { z } from 'zod';
import { createDepot, attachDepotToEcriture } from '@/lib/services/depots';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const metaSchema = z
  .object({
    title: z.string().min(1),
    montant_estime: z.string().optional(),
    date_estimee: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ecriture_id: z.string().optional(),
  })
  .strict();

function parseAmountFr(input: string | undefined): number | null {
  if (!input) return null;
  const normalized = input.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('multipart/form-data attendu.', 415);
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError('Fichier requis.', 400);

  const meta = {
    title: form.get('title') ?? undefined,
    montant_estime: form.get('montant_estime') ?? undefined,
    date_estimee: form.get('date_estimee') ?? undefined,
    ecriture_id: form.get('ecriture_id') ?? undefined,
  } as Record<string, string | undefined>;

  const parsed = metaSchema.safeParse(meta);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  const buf = Buffer.from(await file.arrayBuffer());

  const created = await createDepot(
    { groupId },
    {
      title: parsed.data.title,
      montant_estime_cents: parseAmountFr(parsed.data.montant_estime),
      date_estimee: parsed.data.date_estimee ?? null,
      file: {
        filename: file.name,
        content: buf,
        mime_type: file.type || 'application/octet-stream',
      },
    },
  );

  let attached: { ecriture_id: string; justificatif_id?: string } | null = null;
  if (parsed.data.ecriture_id) {
    try {
      const result = await attachDepotToEcriture({ groupId }, created.id, parsed.data.ecriture_id);
      attached = { ecriture_id: parsed.data.ecriture_id, justificatif_id: (result as any)?.justificatifId };
    } catch (err) {
      // Le dépôt a bien été créé. Si l'attach échoue, on remonte
      // l'erreur pour que le user décide quoi faire — le dépôt reste
      // en 'a_traiter' et matchable manuellement plus tard.
      const msg = err instanceof Error ? err.message : 'Attach failed';
      return Response.json({ depot_id: created.id, attach_error: msg }, { status: 201 });
    }
  }

  return Response.json({ depot_id: created.id, attached }, { status: 201 });
}
```

Adapter les noms de propriétés selon la signature réelle de `createDepot` (cf. Step 1).

- [ ] **Step 3 — Test manuel curl**

Préparer un PDF de test. Tester d'abord la création d'un dépôt orphelin (sans attach) :

```bash
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" \
  -F "title=Facture test mai 2026" \
  -F "montant_estime=42,50" \
  -F "date_estimee=2026-05-10" \
  -F "file=@inbox/test.pdf" \
  http://localhost:3000/api/depots/upload | jq
```

Attendu : `201 { depot_id: "dep_..." }`. Vérifier dans la webapp `/inbox` que le dépôt apparaît côté justifs orphelins.

Ensuite tester avec attach direct :

```bash
ECR=ec_xxx  # une écriture orpheline montant 42,50 date proche
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" \
  -F "title=Facture test attach" \
  -F "montant_estime=42,50" \
  -F "date_estimee=2026-05-10" \
  -F "ecriture_id=$ECR" \
  -F "file=@inbox/test.pdf" \
  http://localhost:3000/api/depots/upload | jq
```

Attendu : `201 { depot_id, attached: { ecriture_id, justificatif_id } }`. L'écriture ne doit plus être orpheline.

- [ ] **Step 4 — Commit**

```bash
git add web/src/app/api/depots/upload/route.ts
git commit -m "feat(api): POST /api/depots/upload

Crée un dépôt orphelin avec fichier joint via multipart. Optionnel :
attach immédiat à une écriture si ecriture_id fourni. Utilisé par le
tool MCP upload_justificatif_orphan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — Routes API webapp (cleanup Comptaweb)

### Task 7 — Route `POST /api/comptaweb/cleanup/dedup`

**Files :**
- Create: `web/src/app/api/comptaweb/cleanup/dedup/route.ts`
- Read for context: `web/src/lib/services/dedup-ecritures.ts:88` (`findCsvDuplicates`) et `:205` (`deleteCsvDuplicates`)

- [ ] **Step 1 — Lire les signatures `findCsvDuplicates` et `deleteCsvDuplicates`**

Lire `web/src/lib/services/dedup-ecritures.ts` lignes 31–280 pour récupérer les shapes `DedupReport`, `DedupCandidate`, `DedupExecResult`, et la signature exacte de `deleteCsvDuplicates`.

Question clé : `deleteCsvDuplicates` prend-il une liste d'`ids` ou supprime-t-il tous les candidats du rapport ? La spec exige le pattern où `apply` reçoit une liste d'`ids` explicite.

- Si la fonction supprime déjà une liste d'`ids` → OK.
- Sinon (elle prend juste `groupId` et supprime tout) → enrichir la fonction service pour accepter `ids?: string[]`, et filtrer en interne (supprimer uniquement si l'id est dans la liste ET reste un doublon vrai).

- [ ] **Step 2 — Étendre `deleteCsvDuplicates` si besoin**

Si l'extension est nécessaire (cf. Step 1), modifier la signature côté service :

```ts
export async function deleteCsvDuplicates(
  ctx: { groupId: string },
  options: { ids?: string[] } = {},
): Promise<DedupExecResult> {
  const report = await findCsvDuplicates({ groupId: ctx.groupId });
  const allowed = options.ids ? new Set(options.ids) : null;
  const targets = report.candidates.filter(
    (c) => !c.loser_has_external_links && (!allowed || allowed.has(c.loser_id)),
  );
  // ... reste inchangé sauf qu'on itère sur `targets` au lieu de
  // `report.candidates`.
}
```

Garder la rétro-compat : si `options.ids` absent, le comportement actuel est inchangé.

- [ ] **Step 3 — Créer le handler de route**

Créer `web/src/app/api/comptaweb/cleanup/dedup/route.ts` :

```ts
import { z } from 'zod';
import { findCsvDuplicates, deleteCsvDuplicates } from '@/lib/services/dedup-ecritures';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const bodySchema = z
  .object({
    mode: z.enum(['preview', 'apply']),
    ids: z.array(z.string().min(1)).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const parsed = await parseJsonBody(request, bodySchema);
  if ('error' in parsed) return parsed.error;

  if (parsed.data.mode === 'preview') {
    const report = await findCsvDuplicates({ groupId });
    return Response.json({ mode: 'preview', ...report });
  }

  if (!parsed.data.ids || parsed.data.ids.length === 0) {
    return jsonError(
      'mode=apply exige une liste ids non vide (issue d\'un preview).',
      400,
    );
  }

  const result = await deleteCsvDuplicates({ groupId }, { ids: parsed.data.ids });
  return Response.json({ mode: 'apply', requested: parsed.data.ids.length, ...result });
}
```

- [ ] **Step 4 — Test manuel curl**

```bash
# Preview
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"preview"}' \
  http://localhost:3000/api/comptaweb/cleanup/dedup | jq

# Apply (refuser sans ids)
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"apply"}' \
  http://localhost:3000/api/comptaweb/cleanup/dedup -i
# Attendu: 400

# Apply avec un id du preview (sur une BDD de test ou si tu valides en vrai)
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"apply","ids":["ec_aaa"]}' \
  http://localhost:3000/api/comptaweb/cleanup/dedup | jq
```

⚠️ Tester `apply` uniquement après accord explicite avec l'utilisateur (suppression d'écritures). Sur la prod, prévoir un dry-run ou un environnement local.

- [ ] **Step 5 — Commit**

```bash
git add web/src/lib/services/dedup-ecritures.ts web/src/app/api/comptaweb/cleanup/dedup/route.ts
git commit -m "feat(api): POST /api/comptaweb/cleanup/dedup (preview/apply)

Expose la dédup post-import via API avec pattern preview/apply :
apply exige une liste d'ids explicite (issue d'un preview précédent)
pour éviter toute suppression non contrôlée. Étend deleteCsvDuplicates
pour accepter un filtre ids optionnel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8 — Route `POST /api/comptaweb/cleanup/transferts`

**Files :**
- Create: `web/src/app/api/comptaweb/cleanup/transferts/route.ts`
- Read for context: `web/src/lib/services/cleanup-transferts.ts:73` (`findInternalTransfers`) et `:124` (`deleteInternalTransfers`)

- [ ] **Step 1 — Adapter le service si besoin**

Même pattern que Task 7 step 2 : vérifier que `deleteInternalTransfers` accepte un filtre `ids?: string[]`. Sinon enrichir :

```ts
export async function deleteInternalTransfers(
  ctx: { groupId: string },
  options: { ids?: string[] } = {},
): Promise<CleanupReport> {
  const candidates = await findInternalTransfers({ groupId: ctx.groupId });
  const allowed = options.ids ? new Set(options.ids) : null;
  const targets = candidates.transferts.filter(
    (t) => !t.has_external_links && (!allowed || allowed.has(t.id)),
  );
  // ... iter sur targets pour DELETE
}
```

- [ ] **Step 2 — Créer le handler**

Créer `web/src/app/api/comptaweb/cleanup/transferts/route.ts` (même structure que Task 7) :

```ts
import { z } from 'zod';
import { findInternalTransfers, deleteInternalTransfers } from '@/lib/services/cleanup-transferts';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const bodySchema = z
  .object({
    mode: z.enum(['preview', 'apply']),
    ids: z.array(z.string().min(1)).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const parsed = await parseJsonBody(request, bodySchema);
  if ('error' in parsed) return parsed.error;

  if (parsed.data.mode === 'preview') {
    const report = await findInternalTransfers({ groupId });
    return Response.json({ mode: 'preview', ...report });
  }

  if (!parsed.data.ids || parsed.data.ids.length === 0) {
    return jsonError("mode=apply exige une liste ids non vide.", 400);
  }

  const result = await deleteInternalTransfers({ groupId }, { ids: parsed.data.ids });
  return Response.json({ mode: 'apply', requested: parsed.data.ids.length, ...result });
}
```

- [ ] **Step 3 — Test manuel curl**

```bash
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"preview"}' \
  http://localhost:3000/api/comptaweb/cleanup/transferts | jq
```

Attendu : liste des candidats détectés (préfixe `DEP-`, pattern dépôt, zombies pré-fix).

- [ ] **Step 4 — Commit**

```bash
git add web/src/lib/services/cleanup-transferts.ts web/src/app/api/comptaweb/cleanup/transferts/route.ts
git commit -m "feat(api): POST /api/comptaweb/cleanup/transferts (preview/apply)

Expose le cleanup des transferts internes mal importés via API.
Pattern preview/apply identique à dedup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9 — Route `POST /api/comptaweb/cleanup/orphelins`

**Files :**
- Create: `web/src/app/api/comptaweb/cleanup/orphelins/route.ts`
- Read for context: `web/src/lib/services/dedup-ecritures.ts:301` (`findOrphansWithoutCategory`) et `:394` (`deleteOrphansWithoutCategory`)

- [ ] **Step 1 — Adapter `deleteOrphansWithoutCategory` si besoin**

Même logique que Tasks 7-8 : ajouter le filtre `ids?: string[]` si absent, en respectant le garde-fou « ne supprime que si exactement 2 lignes partagent `(date, piece, description)` toutes catégories confondues » (déjà implémenté côté service, à ne pas casser).

- [ ] **Step 2 — Créer le handler**

Créer `web/src/app/api/comptaweb/cleanup/orphelins/route.ts` (structure identique à Tasks 7-8, juste les imports changent) :

```ts
import { z } from 'zod';
import { findOrphansWithoutCategory, deleteOrphansWithoutCategory } from '@/lib/services/dedup-ecritures';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const bodySchema = z
  .object({
    mode: z.enum(['preview', 'apply']),
    ids: z.array(z.string().min(1)).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const parsed = await parseJsonBody(request, bodySchema);
  if ('error' in parsed) return parsed.error;

  if (parsed.data.mode === 'preview') {
    const report = await findOrphansWithoutCategory({ groupId });
    return Response.json({ mode: 'preview', ...report });
  }

  if (!parsed.data.ids || parsed.data.ids.length === 0) {
    return jsonError("mode=apply exige une liste ids non vide.", 400);
  }

  const result = await deleteOrphansWithoutCategory({ groupId }, { ids: parsed.data.ids });
  return Response.json({ mode: 'apply', requested: parsed.data.ids.length, ...result });
}
```

- [ ] **Step 3 — Test manuel curl**

```bash
curl -X POST -H "Authorization: Bearer $BALOO_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"preview"}' \
  http://localhost:3000/api/comptaweb/cleanup/orphelins | jq
```

Attendu : liste des écritures `category_id IS NULL` avec leur "twin" candidate. Aucune si la BDD est propre.

- [ ] **Step 4 — Commit**

```bash
git add web/src/lib/services/dedup-ecritures.ts web/src/app/api/comptaweb/cleanup/orphelins/route.ts
git commit -m "feat(api): POST /api/comptaweb/cleanup/orphelins (preview/apply)

Expose le cleanup des ventilations orphelines (category_id NULL avec
twin existante) via API. Garde-fou \"exactement 2 lignes\" préservé.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase D — Tools MCP

### Task 10 — Fichier `compta/src/tools/inbox.ts` (5 tools)

**Files :**
- Create: `compta/src/tools/inbox.ts`
- Read for context: `compta/src/tools/justificatifs.ts` (pattern existant tool + auth + FormData)
- Read for context: `compta/src/api-client.ts` (helper `api.get/post/put/del`)

- [ ] **Step 1 — Lire le pattern api-client**

Lire `compta/src/api-client.ts` en entier. Confirmer la signature des helpers `api.get(path, params?)`, `api.post(path, body)`. Les params query string passent par où ? (à priori `api.get('/api/x', { foo: 'bar' })` les traduit en `?foo=bar`).

- [ ] **Step 2 — Créer le fichier inbox.ts avec les 5 tools**

Créer `compta/src/tools/inbox.ts` :

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

export function registerInboxTools(server: McpServer) {
  server.tool(
    'inbox_list_orphan_ecritures',
    "Liste les écritures dépenses (et optionnellement recettes) sans justificatif attaché",
    {
      period: z
        .enum(['30j', '90j', '6mois', 'tout'])
        .optional()
        .describe('Fenêtre de date_ecriture (défaut: 90j)'),
      recettes: z.boolean().optional().describe('Inclure aussi les recettes orphelines (défaut: false)'),
    },
    async (params) => {
      const query: Record<string, string> = {};
      if (params.period) query.period = params.period;
      if (params.recettes) query.recettes = '1';
      const data = await api.get('/api/inbox/orphan-ecritures', query);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'inbox_list_orphan_justifs',
    'Liste les dépôts de justificatifs en attente (statut a_traiter)',
    {},
    async () => {
      const data = await api.get('/api/inbox/orphan-justifs');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'inbox_suggest_matches',
    "Suggestions lenient (montant ±2%, date ±3j) pour une écriture ou un dépôt orphelin. Fournir EXACTEMENT un des deux paramètres.",
    {
      ecriture_id: z.string().optional(),
      depot_id: z.string().optional(),
    },
    async (params) => {
      if (!!params.ecriture_id === !!params.depot_id) {
        return {
          content: [
            { type: 'text', text: 'Erreur : fournir exactement un de ecriture_id ou depot_id.' },
          ],
        };
      }
      const query: Record<string, string> = {};
      if (params.ecriture_id) query.ecriture_id = params.ecriture_id;
      if (params.depot_id) query.depot_id = params.depot_id;
      const data = await api.get('/api/inbox/suggestions', query);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'inbox_link',
    'Lie une écriture et un dépôt orphelin (équivalent du bouton Lier dans /inbox)',
    {
      ecriture_id: z.string(),
      depot_id: z.string(),
    },
    async (params) => {
      const data = await api.post('/api/inbox/link', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'inbox_auto_match',
    "Déclenche le matching auto strict (montant exact, date ±1j, unicité symétrique). Idempotent.",
    {},
    async () => {
      const data = await api.post('/api/inbox/auto-match', {});
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}
```

- [ ] **Step 3 — Enregistrer dans `compta/src/index.ts`**

Éditer `compta/src/index.ts` pour ajouter l'import et l'appel :

```ts
import { registerInboxTools } from './tools/inbox.js';
// ...
registerInboxTools(server);
```

L'insérer dans le bloc des `registerXxxTools` (ordre alphabétique ou cohérent avec l'existant).

- [ ] **Step 4 — Build le MCP**

```bash
cd compta && pnpm install && pnpm run build
```

Si pas de script `build` : vérifier `compta/package.json` et lancer `tsc` directement si besoin (ou `pnpm tsx src/index.ts --check`).

- [ ] **Step 5 — Test E2E rapide depuis Claude Desktop**

Redémarrer Claude Desktop pour qu'il recharge le MCP. Dans une conversation, demander :

> « Liste les écritures orphelines des 30 derniers jours. »

Vérifier que Claude appelle `inbox_list_orphan_ecritures({period: '30j'})` et renvoie une liste cohérente.

> « Suggère des matches pour l'écriture ec_xxx. »

Vérifier `inbox_suggest_matches`.

> « Lance l'auto-match. »

Vérifier `inbox_auto_match`.

- [ ] **Step 6 — Commit**

```bash
cd <repo-root>
git add compta/src/tools/inbox.ts compta/src/index.ts
git commit -m "feat(mcp): tools inbox (orphelins, suggestions, link, auto-match)

5 tools MCP pour piloter l'inbox des justificatifs depuis Claude :
- inbox_list_orphan_ecritures
- inbox_list_orphan_justifs
- inbox_suggest_matches
- inbox_link
- inbox_auto_match

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11 — Tool MCP `upload_justificatif_orphan`

**Files :**
- Create: `compta/src/tools/upload-orphan.ts`
- Read for context: `compta/src/tools/justificatifs.ts` (pattern multipart existant)

- [ ] **Step 1 — Créer le tool**

Créer `compta/src/tools/upload-orphan.ts` :

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { ApiError } from '../api-client.js';

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function guessMimeType(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? MIME_TYPES[ext] : undefined;
}

export function registerUploadOrphanTool(server: McpServer) {
  server.tool(
    'upload_justificatif_orphan',
    "Upload un fichier (PDF/image) depuis un chemin local et crée un dépôt orphelin (statut a_traiter). Si ecriture_id est fourni, le dépôt est immédiatement attaché à cette écriture.",
    {
      file_path: z.string().describe('Chemin absolu ou relatif du fichier source'),
      title: z.string().describe("Titre lisible du justificatif (ex: 'Facture Decathlon')"),
      montant_estime: z
        .string()
        .regex(/^-?\d+(,\d{1,2})?$/)
        .optional()
        .describe("Montant estimé au format FR (ex: '42,50')"),
      date_estimee: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Date estimée de la dépense au format ISO YYYY-MM-DD'),
      ecriture_id: z.string().optional().describe('Si fourni : attache direct à cette écriture'),
    },
    async (params) => {
      if (!existsSync(params.file_path)) {
        return { content: [{ type: 'text', text: `Fichier non trouvé : ${params.file_path}` }] };
      }

      const buffer = readFileSync(params.file_path);
      const filename = basename(params.file_path);
      const mime = guessMimeType(filename);

      const baseUrl = (process.env.BALOO_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
      const form = new FormData();
      form.set('title', params.title);
      if (params.montant_estime) form.set('montant_estime', params.montant_estime);
      if (params.date_estimee) form.set('date_estimee', params.date_estimee);
      if (params.ecriture_id) form.set('ecriture_id', params.ecriture_id);
      form.set(
        'file',
        new Blob([new Uint8Array(buffer)], mime ? { type: mime } : undefined),
        filename,
      );

      const headers: Record<string, string> = {};
      const token = process.env.BALOO_API_TOKEN;
      if (token) headers.authorization = `Bearer ${token}`;

      const response = await fetch(`${baseUrl}/api/depots/upload`, {
        method: 'POST',
        body: form,
        headers,
      });
      const text = await response.text();
      if (!response.ok) {
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* ignore */
        }
        throw new ApiError(response.status, body);
      }
      const created = text ? JSON.parse(text) : {};
      return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
    },
  );
}
```

- [ ] **Step 2 — Enregistrer dans `compta/src/index.ts`**

```ts
import { registerUploadOrphanTool } from './tools/upload-orphan.js';
// ...
registerUploadOrphanTool(server);
```

- [ ] **Step 3 — Rebuild + test E2E Claude Desktop**

```bash
cd compta && pnpm run build
```

Préparer un PDF dans `inbox/test.pdf`. Demander à Claude :

> « Upload le fichier `inbox/test.pdf` comme justif orphelin titré "Test upload mai 2026", montant estimé 12,30€, date 2026-05-12. »

Vérifier que Claude appelle `upload_justificatif_orphan` et que le dépôt apparaît dans `/inbox` côté webapp.

- [ ] **Step 4 — Commit**

```bash
git add compta/src/tools/upload-orphan.ts compta/src/index.ts
git commit -m "feat(mcp): tool upload_justificatif_orphan

Permet de pousser un PDF/image depuis le filesystem local (typiquement
inbox/) comme dépôt orphelin, avec attach optionnel à une écriture.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12 — Tools MCP cleanup dans `compta/src/tools/comptaweb.ts`

**Files :**
- Modify: `compta/src/tools/comptaweb.ts`

- [ ] **Step 1 — Lire le fichier existant**

Lire `compta/src/tools/comptaweb.ts` en entier (probablement < 200 lignes). Repérer la fonction `registerComptawebTools(server)` et où ajouter les nouveaux `server.tool(...)`.

- [ ] **Step 2 — Ajouter les 3 tools de cleanup**

À la fin de `registerComptawebTools` (juste avant le `}` de clôture) :

```ts
  server.tool(
    'cw_cleanup_dedup',
    "Détecte ou supprime les doublons d'écritures Comptaweb. mode='preview' liste les candidats ; mode='apply' supprime ceux dont les ids sont fournis.",
    {
      mode: z.enum(['preview', 'apply']),
      ids: z.array(z.string()).optional().describe("Liste des loser_id à supprimer (obligatoire si mode=apply)"),
    },
    async (params) => {
      const data = await api.post('/api/comptaweb/cleanup/dedup', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cw_cleanup_transferts',
    "Détecte ou supprime les transferts internes mal importés (préfixe DEP-, patterns dépôt). mode='preview' / mode='apply' avec ids.",
    {
      mode: z.enum(['preview', 'apply']),
      ids: z.array(z.string()).optional(),
    },
    async (params) => {
      const data = await api.post('/api/comptaweb/cleanup/transferts', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cw_cleanup_orphelins',
    "Détecte ou supprime les ventilations orphelines (category_id NULL avec twin). mode='preview' / mode='apply' avec ids.",
    {
      mode: z.enum(['preview', 'apply']),
      ids: z.array(z.string()).optional(),
    },
    async (params) => {
      const data = await api.post('/api/comptaweb/cleanup/orphelins', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
```

S'assurer que `api` (ou `apiClient`) est déjà importé en haut du fichier. Sinon ajouter `import { api } from '../api-client.js';`.

- [ ] **Step 3 — Rebuild + test E2E Claude Desktop**

```bash
cd compta && pnpm run build
```

Redémarrer Claude Desktop. Tester :

> « Fais un preview du cleanup dedup Comptaweb. »

Vérifier appel `cw_cleanup_dedup({mode: 'preview'})` et réponse cohérente.

Tester preview pour les trois cleanups :

> « Preview les transferts internes mal importés. »
> « Preview les ventilations orphelines. »

⚠️ NE PAS lancer `apply` sur la prod sans accord explicite et sans avoir relu le preview.

- [ ] **Step 4 — Commit**

```bash
git add compta/src/tools/comptaweb.ts
git commit -m "feat(mcp): tools cleanup Comptaweb (dedup, transferts, orphelins)

3 tools cw_cleanup_* avec pattern preview/apply pour pilotter les
nettoyages post-import depuis Claude. apply exige une liste d'ids
explicite issue d'un preview précédent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13 — Vérifier le tool MCP `attach_justificatif`

**Files :**
- Read: `compta/src/tools/justificatifs.ts` (le tool appelle `POST /api/justificatifs` qui existe maintenant)

- [ ] **Step 1 — Tester `attach_justificatif` depuis Claude Desktop**

Après la Task 5, la route `POST /api/justificatifs` existe. Le tool `attach_justificatif` doit donc fonctionner directement. Préparer une écriture `ecriture_id` sans justif et un PDF local, demander :

> « Attache le fichier `inbox/test.pdf` à l'écriture ec_xxx. »

Vérifier appel `attach_justificatif`, réponse 201, et présence du justif sur `/ecritures/ec_xxx` côté webapp.

Si échec : déboguer (probablement un mismatch sur le payload — adapter soit la route Task 5 soit le tool pour qu'ils se parlent).

- [ ] **Step 2 — Commit (si modification nécessaire)**

Si le tool nécessite un ajustement (ex: ajout du `Authorization` header qui manquait, fix d'un nom de champ), faire les changements et commit séparé :

```bash
git add compta/src/tools/justificatifs.ts
git commit -m "fix(mcp): attach_justificatif compatible avec la nouvelle route

(détails du fix)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Sinon : pas de commit, juste valider mentalement que le tool fonctionne.

---

## Phase E — Vérification E2E intégrée

### Task 14 — Scénario complet « réception d'un justif par mail »

**Pas de fichier à créer. Vérification manuelle bout en bout.**

- [ ] **Step 1 — Préparer un cas de test**

Sur une BDD locale (`pnpm dev`), créer manuellement une écriture en brouillon montant 27,50€ date 2026-05-10 (catégorie « Camp été », mode CB, unité PC). Préparer un PDF de facture dans `inbox/facture-decathlon.pdf` (n'importe quel PDF d'au moins quelques ko).

- [ ] **Step 2 — Workflow Claude Desktop**

Dans Claude Desktop (MCP `compta` actif) :

> « J'ai reçu une facture Decathlon par mail, je l'ai posée dans `inbox/facture-decathlon.pdf`. Upload-la comme justif orphelin, titre "Facture Decathlon", montant 27,50, date 2026-05-10. »

Claude doit appeler `upload_justificatif_orphan`. Vérifier dans `/inbox` que le dépôt apparaît.

> « Cherche les écritures orphelines des 30 derniers jours. »

`inbox_list_orphan_ecritures`. Vérifier que l'écriture brouillon 27,50€ apparaît.

> « Suggère des matches pour cette écriture. »

`inbox_suggest_matches`. Le dépôt uploadé doit être dans les matches.

> « Lie-les. »

`inbox_link`. Vérifier que ni l'écriture ni le dépôt ne sont plus orphelins (re-tester les routes list).

- [ ] **Step 3 — Alternative auto-match**

Refaire le test précédent (créer une 2ᵉ écriture + 2ᵉ PDF avec montant et date strictement identiques) :

> « Lance l'auto-match. »

`inbox_auto_match`. Vérifier que la paire est liée automatiquement.

- [ ] **Step 4 — Note de tests faits**

Garder une trace mentale du résultat. Pas de commit ici (vérification).

---

### Task 15 — Scénario « cleanup post-import Comptaweb »

**Pas de fichier à créer. Vérification manuelle.**

- [ ] **Step 1 — Provoquer ou trouver un cas de doublons**

Si la BDD locale a déjà des doublons (issus d'un ré-import CSV), tant mieux. Sinon : ré-importer un CSV Comptaweb deux fois de suite via `/import` pour générer des doublons.

- [ ] **Step 2 — Workflow Claude Desktop**

> « Preview les doublons Comptaweb. »

`cw_cleanup_dedup({mode: 'preview'})`. Lire la sortie : liste des `loser_id` candidats à suppression + `winner_id` correspondants + raison.

> « Supprime les doublons aaa, bbb, ccc. »

`cw_cleanup_dedup({mode: 'apply', ids: ['aaa', 'bbb', 'ccc']})`. Vérifier `requested: 3, deleted: 3, skipped: []`.

Tester transferts et orphelins idem (preview seulement si rien à supprimer).

- [ ] **Step 3 — Note de tests faits**

Pas de commit.

---

## Self-Review

Après écriture du plan, vérifier :

**1. Spec coverage** :

- Inbox list orphelins → Task 1 ✓
- Inbox suggestions → Task 2 ✓
- Inbox link manuel → Task 3 ✓
- Inbox auto-match → Task 4 ✓
- Upload PDF (à entité) → Task 5 ✓
- Upload PDF (orphelin) → Task 6 + Task 11 ✓
- Cleanup dedup → Task 7 + Task 12 ✓
- Cleanup transferts → Task 8 + Task 12 ✓
- Cleanup orphelins → Task 9 + Task 12 ✓
- Tools MCP → Tasks 10-13 ✓
- Vérif E2E → Tasks 14-15 ✓

Tout est couvert.

**2. Placeholders** : Aucun `TODO`, `TBD`, `implement later`, `add error handling`. Chaque step a du code ou une commande concrète.

**3. Cohérence des types** : Les noms d'API params sont cohérents (`ecriture_id`, `depot_id`, `mode`, `ids`) à travers les tasks. Les tools MCP utilisent les mêmes noms que les routes API. Les services existants ne sont pas renommés.

**4. Conventions projet respectées** :

- Pattern auth via `requireApiContext` ✓
- Validation zod ✓
- Pas de CHECK SQL ajoutée ✓
- Tests vitest réservés aux modules purs (aucun ajouté car aucun nouveau module pur) ✓
- Vérification manuelle pour API + tools ✓
- Pas de push automatique (commits locaux uniquement) ✓
- Co-Authored-By dans tous les commits ✓

**5. Points d'attention** :

- Si `listInboxItems` ne factorise pas les suggestions par entité, la Task 2 demande d'extraire deux helpers. À évaluer au moment de l'impl (pas un blocage, juste du refactor).
- Les services `deleteCsvDuplicates`, `deleteInternalTransfers`, `deleteOrphansWithoutCategory` doivent peut-être accepter un filtre `ids` (Tasks 7-9 Step 1-2). À vérifier au moment de l'impl.
- Le tool `attach_justificatif` existant peut nécessiter un fix mineur (Task 13). À vérifier après Task 5.

---

## Suite

Une fois les 15 tasks complétées :

1. Tester l'ensemble end-to-end avec un scénario réaliste (cf. Tasks 14-15).
2. Push vers main (avec accord explicite user).
3. Vercel deploy auto.
4. Régénérer le token MCP si nécessaire et redémarrer Claude Desktop.
5. Annoncer la dispo au user → premiers usages en prod.
6. Planifier le sous-projet suivant (recommandé : C. Admin & invitations).
