# Spec — Sync incrémental Comptaweb (Phase 2 du pivot miroir strict)

**Date** : 2026-05-19
**Statut** : design validé, prêt à plan d'impl
**Phase** : 2 du pivot V1 ([spec parent](2026-05-18-baloo-miroir-mcp-first-design.md), [ADR-031](../decisions.md#adr-031--baloo-miroir-strict-de-comptaweb--mcp-first))

---

## Contexte

Phase 1 du pivot (livrée 2026-05-19, ADR-031) a posé le cycle de vie miroir des écritures : `draft → pending_cw → pending_sync → mirror → divergent`, avec `createEcritureAndPushToCw` qui pilote Comptaweb puis miroir BDD. Les écritures atteignent `pending_sync` après un push CW réussi, mais **rien ne les promeut en `mirror`** aujourd'hui — c'est l'objet de cette Phase 2.

Côté lignes bancaires non rapprochées, le service `scanDraftsFromComptaweb()` existe (création de drafts à partir de `listRapprochementBancaire`), mais n'est pas branché sur un cycle de sync orchestré.

Phase 2 livre :
1. Un **service de sync incrémental** qui promeut `pending_sync → mirror` et maintient les drafts orphelins.
2. Un **scraper liste écritures CW complet** (option B retenue : robuste face aux écritures déjà rapprochées côté CW, qui disparaissent du rapprochement bancaire).
3. Une **table d'audit `sync_runs`** + throttle 15 min + verrou par groupe.
4. Une **UI client-piloté** : un composant header `<SyncStatusButton>` qui déclenche la sync, poll le statut, et `router.refresh()` quand fini.

## Objectifs

1. **Pas d'écriture `pending_sync` bloquée** : une écriture envoyée à CW est promue en `mirror` dès le sync suivant (au plus 15 min, ou immédiat via force).
2. **Lignes bancaires orphelines visibles en inbox** : maintenues à jour à chaque cycle (nouvelles lignes créées en `draft`, lignes disparues silencieusement gardées — règle UPSERT).
3. **Aucun cron, aucun fire-and-forget** : la sync est pilotée par le client (composant header) et par les tools MCP sensibles (`ensureSyncFresh`). Pattern uniforme.
4. **Audit complet** : chaque sync laisse une trace dans `sync_runs` (counts, durée, anomalies, erreur).
5. **Multi-tenant strict** : sync isolée par groupe (chaque groupe = ses propres credentials CW).

## Non-objectifs (Phase 2)

- **Refresh tokens MCP** (toujours hors scope V1).
- **Pré-warming background** : pas de Vercel Cron, pas de sync proactive sans interaction utilisateur. Le sync se déclenche au `mount` du composant header (donc au premier render utilisateur après stale).
- **Résolution automatique des `divergent`** : on détecte, on alerte au dashboard, mais l'arbitrage reste manuel (Phase 4 dogfood).
- **Dashboard `/` complet** : la Phase 2 ne livre que le bouton header. Le dashboard "ce qui va / pas" est Phase 4.

---

## Architecture

```
┌──────────────────────────────────────┐
│  Client (browser / Claude.ai)        │
│  ─ <SyncStatusButton> (header)       │ Mount → GET status → POST run si stale
│  ─ MCP tools                         │           Poll status → router.refresh()
└─────┬────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────┐
│  /api/sync/run     /api/sync/status  │ Endpoints HTTP
└─────┬────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────┐
│  runSyncCycle(groupId, { force? })   │ Orchestrateur
│  ─ throttle 15 min                   │
│  ─ verrou running < 60 s             │
│  ─ INSERT sync_runs(running)         │
│  ├─ scrapeListeEcritures(exercice)   │ Liste complète CW
│  ├─ listRapprochementBancaire()      │ Lignes bancaires non rapprochées
│  ├─ promotePendingSyncToMirror()     │ Match cw_numero_piece → mirror
│  ├─ maintainOrphanBankDrafts()       │ UPSERT drafts depuis rapp bancaire
│  ├─ detectDivergent()                │ Compare montant/date Baloo vs CW
│  └─ UPDATE sync_runs(ok|failed)      │
└──────────────────────────────────────┘
```

### Décisions architecturales

1. **Client-piloté** : pas de `after()`, pas de cron, pas de fire-and-forget. Le composant client mount → check stale → POST run → poll → `router.refresh()`. Côté MCP, les tools sensibles appellent `runSyncCycle` synchrone via helper `ensureSyncFresh()` avant de répondre.
2. **Sync par groupe** : `sync_runs.group_id` indexé. Throttle ET verrou running filtrent par `group_id`. Aucune logique cross-tenant.
3. **Liste complète CW (Option B)** : on construit `scrapeListeEcritures(exercice)` pour matcher les écritures déjà rapprochées côté CW (qui disparaissent de `listRapprochementBancaire`). Robuste mais ~2 j d'effort supplémentaires vs option rapprochement-seul.
4. **UPSERT impératif** : règle "JAMAIS de DELETE" du CLAUDE.md s'applique. Pour les drafts orphelins, on UPDATE les champs Baloo via `COALESCE(champ_actuel, ?)` pour préserver les enrichissements (justifs liés, notes, etc.).
5. **Verrou simple** : INSERT initial dans `sync_runs(status='running')` + check "déjà un running pour ce group_id < 60 s" → skip. Pas de transaction explicite, pas de lock advisory.

---

## Schéma BDD

### Table `sync_runs`

```sql
CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  started_at TEXT NOT NULL,         -- ISO timestamp
  finished_at TEXT,                  -- NULL si encore running
  status TEXT NOT NULL,              -- 'running' | 'ok' | 'failed' | 'skipped'
  trigger TEXT NOT NULL,             -- 'client' | 'mcp' | 'manual'
  promoted_to_mirror INTEGER NOT NULL DEFAULT 0,
  new_drafts INTEGER NOT NULL DEFAULT 0,
  updated_drafts INTEGER NOT NULL DEFAULT 0,
  divergent_detected INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,                -- si status='failed'
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_group_started
  ON sync_runs(group_id, started_at DESC);
```

**Pas de CHECK SQL** sur `status` (cf. AGENTS.md : workflow statuses validés côté code, pas en BDD).

Migration via pattern `ensureBusinessSchema` existant.

---

## Flows détaillés

### 1. Mount client → premier sync

```
[<SyncStatusButton> mount]
  → GET /api/sync/status
  → Backend renvoie : { last_run: {...}, is_running: false, stale: true|false }
  → Si stale (last_run.started_at < now - 15 min OR pas de run) :
      → Composant montre "Synchronisation…"
      → POST /api/sync/run
      → Backend lance runSyncCycle()
        ├─ INSERT sync_runs(running)
        ├─ Récup config CW pour le groupe
        ├─ Scrape liste complète + rapprochement (en parallèle Promise.all)
        ├─ Promote pending_sync → mirror par match cw_numero_piece
        ├─ Upsert drafts bancaires orphelins
        ├─ Détecte divergents (mirror dont montant/date diffèrent côté CW)
        └─ UPDATE sync_runs(ok, counts...)
      → Polling GET /api/sync/status toutes les 2 s
      → Quand finished_at non NULL → router.refresh()
      → Composant montre "synced il y a quelques secondes"
```

### 2. Tool MCP appelé → ensureSyncFresh

```
[Tool MCP sensible appelé via /api/mcp]
  → Wrapper ensureSyncFresh(groupId)
  → Check sync_runs.last_run.started_at
  → Si stale (>15 min) :
      → await runSyncCycle(groupId, { trigger: 'mcp' })  // bloquant
      → Le tool s'exécute après avec données fraîches
  → Sinon : le tool s'exécute directement
```

Tools sensibles ciblés (Phase 2) : `list_ecritures`, `vue_ensemble`, `cw_list_rapprochement_bancaire`. Autres tools en dehors du périmètre comptable strict ne déclenchent pas le sync (perf).

### 3. Force sync

Bouton header explicite : POST `/api/sync/run?force=1`. Override le throttle 15 min mais respecte toujours le verrou running < 60 s (pas de double exécution simultanée).

### 4. Promotion `pending_sync` → `mirror`

```
Pour chaque ecriture status='pending_sync' du groupe :
  - Cherche dans listEcrituresCW (scrapeListeEcritures) une CW dont numero_piece = ecriture.cw_numero_piece
  - Si trouvé :
      → Compare montant, date, type Baloo vs CW
      → Si match exact → UPDATE status='mirror'
      → Si écart → UPDATE status='divergent' + log divergent_detected
  - Si pas trouvé :
      → Si started_at < now - 1h → log warning "stale pending_sync"
      → Laisse en pending_sync (re-tentera prochain cycle)
```

### 5. Maintien drafts orphelins

Réutilise `scanDraftsFromComptaweb()` existant (lib/services/drafts.ts), avec deux ajustements :
- Appel dans le cycle orchestré (pas en endpoint standalone)
- Comptage `new_drafts` / `updated_drafts` retourné pour `sync_runs`

UPSERT par `(group_id, ligne_bancaire_id, ligne_bancaire_sous_index)`. Préservation stricte des enrichissements Baloo via `COALESCE`.

---

## API

### `GET /api/sync/status`

```json
{
  "group_id": "g_abc",
  "last_run": {
    "id": "sync_xyz",
    "started_at": "2026-05-19T12:34:56Z",
    "finished_at": "2026-05-19T12:35:08Z",
    "status": "ok",
    "trigger": "client",
    "promoted_to_mirror": 3,
    "new_drafts": 1,
    "updated_drafts": 0,
    "divergent_detected": 0,
    "duration_ms": 12000
  },
  "is_running": false,
  "stale": false,
  "throttle_until": "2026-05-19T12:50:08Z"
}
```

### `POST /api/sync/run`

Query param optionnel `?force=1` pour override throttle.

Body : aucun.

Réponses :
- `202 Accepted` + `{ sync_run_id }` : lancement OK (le client polle `/status`).
- `429 Too Many Requests` : throttle actif sans force, ou un run déjà `running < 60 s`.
- `403 Forbidden` : role insuffisant (ADMIN_ROLES requis).
- `500` : échec inattendu d'initialisation.

Le sync s'exécute **dans le handler** (await) pour Vercel serverless. Durée typique 5-15 s. Si > 60 s (deadline Vercel Fluid), le sync est probablement coincé sur scraper CW : on accepte le timeout, le sync_run reste en `running` et sera marqué `failed` par le check stale du run suivant.

### Tool MCP `sync_run`

Wrapper sur POST `/api/sync/run`. Args : `force?: boolean`. Retourne le sync_run final (await la fin, polling interne si besoin).

---

## UI — `<SyncStatusButton>` (header)

Composant client (`'use client'`), monté dans le layout `(app)/layout.tsx`. États :

| État | Affichage | Action clic |
|---|---|---|
| `idle` (fresh < 15 min) | Icône check + "synced il y a 3 min" | POST force=1 |
| `idle` (stale) | Icône warning + "stale 47 min" | POST run |
| `running` | Spinner + "syncing…" | Désactivé |
| `error` | Icône erreur + "échec — réessayer" | POST run |

Hook `useSyncStatus` :
- Mount : GET status
- Si stale → POST run automatiquement
- Si is_running → poll toutes les 2 s jusqu'à finished
- À la fin → `router.refresh()` + state idle
- Refetch status au focus de l'onglet (visibility API)

---

## Tests

- **Unit `scrapeListeEcritures`** : fixtures HTML CW (3+ snapshots représentatifs), parsing exhaustif des colonnes (date, numero_piece, montant signé, type, intitulé, nature, mode_paiement).
- **Unit `runSyncCycle`** : mock scraper + DB, scénarios :
  - Promotion : 2 `pending_sync` matchés → 2 mirror
  - Divergent : montant Baloo ≠ CW → status divergent + count
  - Stale pending_sync > 1h non matché → log warning
  - Drafts : nouvelle ligne bancaire → 1 nouveau draft
  - Drafts : ligne bancaire existante → 0 nouveau, 0 update si rien à enrichir
  - Throttle : run < 15 min → skipped sans force
  - Verrou : running < 60 s → 429
- **Integration `/api/sync/run`** : auth ADMIN_ROLES, force, idempotence, 429.
- **UI `<SyncStatusButton>`** : transitions d'états, polling, refresh trigger.
- **MCP** : `ensureSyncFresh` mock, tool `sync_run` end-to-end.

Cible : +60 tests, total ~321.

---

## Migration BDD

Via pattern `ensureBusinessSchema` existant. Idempotente :
1. `CREATE TABLE IF NOT EXISTS sync_runs (...)`
2. `CREATE INDEX IF NOT EXISTS idx_sync_runs_group_started`

Aucun data backfill nécessaire (la table est nouvelle, premier sync laissera la première trace).

---

## Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| `scrapeListeEcritures` parse fragile (refonte UI CW) | Élevé | Fixtures HTML versionnées + tests snapshot. Log parse fail explicite côté `/admin/errors`. |
| Sync dépasse 60 s Vercel | Moyen | Timeout côté handler explicite, sync_run marqué `failed` au prochain run. Surveiller `duration_ms` dans `sync_runs`. |
| Double-trigger client + MCP | Faible | Verrou running < 60 s → MCP reçoit 429, attend prochain cycle. |
| `pending_sync` bloqué (CW perdu l'écriture) | Moyen | Alerte stale > 1h au dashboard (Phase 4). En attendant : warning dans `sync_runs.error_message` + log. |
| Divergent détecté en masse (drift historique) | Faible | Détection seulement sur les écritures déjà `mirror` ; pour les nouveaux promus, pas de comparaison rétroactive. |
| Multi-trésorier même groupe : 2 syncs concurrents | Couvert | Verrou par `group_id` (pas par user). |

---

## Conséquences sur Phases suivantes

- **Phase 3 (dogfood 2 semaines)** : usage exclusif MCP via Claude.ai — `ensureSyncFresh` doit être fiable, sinon les tools voient des données stales. Phase 2 est un prérequis dur.
- **Phase 4 (dashboard)** : cartes "stale pending_sync", "divergents à arbitrer", "derniers syncs" alimentées par `sync_runs`. Phase 2 pose les data.
- **Phase 5 (admin caché)** : import CSV legacy déplacé sous `/admin/sync`, complète la trace `sync_runs` avec sync manuel complet.

---

## Décisions structurantes à acter

À l'issue de la Phase 2, créer un ADR référençant cette spec et capturant :
- "Sync incrémental Comptaweb client-piloté (mount header + ensureSyncFresh MCP), pas de cron"
- "Verrou sync par `group_id`, throttle 15 min, table `sync_runs` audit"
- "`scrapeListeEcritures(exercice)` est le canal de matching mirror (pas le rapprochement bancaire seul)"
