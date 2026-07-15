# Sync Comptaweb robuste — plafond, pool parallèle, auto-drainage

**Date :** 2026-07-15
**Statut :** conception validée
**Contexte :** [[project_sync_reconciliation]], `web/AGENTS.md` (§ « Un timeout Vercel laisse le run bloqué en `status='running'` »)

## Problème

En prod, la sync incrémentale Comptaweb (`/api/sync/run`, `runSyncCycle`)
s'affiche régulièrement « Sync interrompue ». Symptôme : le run reste bloqué
en `status='running'` sans `error_message`, l'UI le détecte comme interrompu
(`last_run.status==='running' && is_running===false`, lock 60 s expiré).

**Cause racine.** `runSyncCycle` (`web/src/lib/services/sync-cycle.ts`)
traite les écritures à enrichir **séquentiellement et sans plafond** : pour
chaque `cwId` de l'ensemble `toProcess`, il appelle `processCwEcriture` →
`resolveVentilations` → `scrapeDetail(cwId)`, soit **une requête HTTP
Comptaweb par écriture, en série** (sync-cycle.ts:820, :336). Le temps total
d'un cycle vaut :

```
T ≈ scanDrafts + scrapeListe   (coûts fixes, bornés)
  + N × (aller-retour CW détail)   (N = |toProcess|, NON borné)
```

Quand beaucoup d'écritures n'ont pas encore leur imputation (début
d'exercice, gros import CSV, arrivée de plusieurs écritures CW d'un coup), N
monte à 30-80. À ~0,5-2 s la requête CW, plus le cold start Vercel et un
Comptaweb parfois lent, on dépasse `maxDuration = 60 s`. La **lambda est tuée
par le timeout** avant que le `catch` de `runSyncCycle` (qui écrirait
`status='failed'` + message) ne s'exécute. La ligne `sync_runs` reste donc
`running` pour toujours → « interrompue ». Ce n'est pas ponctuel : **plus il
y a d'écritures à enrichir, plus c'est lent, et au-delà d'un seuil ça
timeoute systématiquement**. Cliquer « Réessayer » ne change rien tant que N
reste gros.

## Objectif

Rendre chaque cycle **court par construction** (jamais de timeout), quel que
soit le nombre d'écritures à enrichir, tout en garantissant que **tout finit
par être synchronisé** sans intervention manuelle.

Décisions produit validées (2026-07-15) :
- **Auto-drainage en fond** : le travail restant est drainé automatiquement
  par des cycles enchaînés côté client, zéro clic.
- **Réglage prudent** : plafond **K = 12** détails/cycle, **pool = 4**
  requêtes CW simultanées.

## Approche

Trois leviers combinés, du plus structurant au plus cosmétique.

### A — Plafond de travail par cycle (K = 12)

On borne le nombre de `scrapeDetail` exécutés par cycle à **12**.

- Le plan de réconciliation (`reconcile`, fonction pure, rapide) reste
  calculé **en entier**. Les opérations qui **ne coûtent pas de fetch détail**
  — deletions (`plan.deletions`), suggestions (`plan.suggestions`), transferts
  inter-structures (`importHorsResultatTransfers`), heal, détection stale —
  s'exécutent **toujours et intégralement**. Le plafond ne concerne QUE
  l'ensemble `toProcess` (les cwId qui déclenchent une lecture détail CW).

- `toProcess` passe de `Set<number>` à une **liste ordonnée par priorité**,
  puis tronquée à K. Ordre de priorité (le plus visible pour l'utilisateur
  d'abord) :
  1. **promotions** — un draft reconnu dans CW devient `mirror` : visible tout
     de suite dans « Bouclées ».
  2. **imports** — écriture CW sans équivalent Baloo : nouvelle ligne à créer.
  3. **updates d'enrichissement** — écriture reliée mais imputation vide /
     signature changée (`u.needsDetail`).
  4. **agrégats legacy** (bloc 7c-bis) — cwId complet mais ventilations
     détachées à résorber.

  À l'intérieur d'une même priorité, l'ordre d'insertion (donc de découverte
  dans `snapshot`/`plan`) est conservé — déterministe.

- **Attention promotions.** Une promotion pose déjà `comptaweb_ecriture_id +
  status='mirror'` par un `UPDATE` (sync-cycle.ts:772-780) AVANT le traitement
  détail. Si une promotion est **au-delà** du budget K, son `UPDATE` de liaison
  doit tout de même être appliqué (le lien draft→cwId est correct et bon à
  poser), mais son `cwId` ne doit **pas** entrer dans les K `scrapeDetail` de
  ce cycle — il rejoint `remaining` et sera enrichi au cycle suivant (il
  retombera alors en priorité « updates d'enrichissement », `needsDetail`
  vrai puisque imputation encore vide). Autrement dit : **les liaisons se
  posent toutes ; seuls les fetch détail sont plafonnés.**

- **Convergence.** Les K cwId traités sont marqués enrichis
  (`comptaweb_synced`, imputation posée) → au cycle suivant ils ne
  réapparaissent plus dans `needsDetail`/imports (idempotence déjà en place,
  cf. flags d'enrichissement sync-cycle.ts:381). Chaque cycle draine donc au
  moins min(K, restant) écritures, sans jamais retraiter les précédentes.

- **`remaining`.** Le résultat du cycle expose
  `remaining = |toProcess complet| − |traité ce cycle|` (≥ 0). C'est le signal
  d'auto-drainage. Il est aussi persisté dans `sync_runs.remaining` (utile au
  diagnostic `/admin/errors` et au statut).

### B — Pool parallèle de fetch détail (concurrence = 4)

Le HTTP CW est le coût dominant ; les écritures BDD (INSERT/UPDATE libsql)
doivent rester **séquentielles** (transactions concurrentes = risque). On
découple donc les deux phases :

- **Phase 1 — fetch (parallèle).** Pour les ≤ K cwId retenus, exécuter les
  `scrapeDetail(cwId)` via un **pool de concurrence 4** (au plus 4 requêtes CW
  en vol). Résultat : `Map<cwId, EcritureDetail | 'error'>`. Un fetch qui
  échoue est mémorisé comme échec (log via `logError`, cf. gestion actuelle
  resolveVentilations:337) et n'interrompt pas les autres.

- **Phase 2 — application (séquentielle).** La boucle existante
  `for (const cwId of toProcess retenus)` appelle `processCwEcriture`
  **inchangé dans sa logique d'écriture**, mais les resolvers reçoivent un
  `scrapeDetail` qui lit **d'abord la Map** (détail déjà fetché en phase 1) et
  ne retombe sur le réseau qu'en absence d'entrée (filet ; ne devrait pas
  arriver). Les writes ne se chevauchent pas.

  Les résolutions référentielles internes (`resolveCategoryId`,
  `resolveActiviteId`, `resolveUniteId` — lectures BDD locales/Turso, rapides)
  restent séquentielles comme aujourd'hui : elles ne sont pas le goulot.

Le pool est un helper générique `mapWithConcurrency(items, limit, fn)`
(module pur testable), réutilisable.

### Auto-drainage côté client

Le POST `/api/sync/run` reste **synchrone** (attend la fin du cycle, court par
construction) et renvoie le `SyncCycleResult` incluant `remaining`.

Dans `use-sync-status.ts` (`runSync`) :
- Après un run `status='ok'`, lire `remaining` dans la réponse.
- Si `remaining > 0` → **relancer immédiatement** `runSync(true)` (force=1,
  bypass throttle 15 min), jusqu'à `remaining === 0`.
- Sinon → `router.refresh()` comme aujourd'hui.

**Garde-fou anti-boucle.** On suit `remaining` d'un cycle au suivant. Si
`remaining` **ne décroît pas** (aucun progrès : CW en panne, tous les fetch
échouent, budget « mangé » par des cwId qui reviennent), on stoppe après **2
cycles consécutifs sans progrès** et on laisse l'état retomber sur le
diagnostic normal (échec / interrompu). Empêche le drainage de boucler à
l'infini contre un Comptaweb cassé.

**Indicateur.** Le hook expose `remaining` ; `SyncStatusButton` affiche
pendant le drainage « Synchronisation… (N restantes) » (chiffre décroissant).
Le verrou `already_running` (60 s) protège toujours de deux cycles simultanés.

## Ce qui NE change pas

- Grain canonique = ventilation ; réconciliation pure (`reconcile`,
  `reconcileVentilations`) ; self-heal des drafts ; import transferts ;
  détection stale — **logique identique**.
- `maxDuration` reste **60 s** : plus besoin de le monter, chaque cycle est
  court. (Levier « C » de l'analyse initiale abandonné — inutile ici.)
- Aucune règle de préservation violée : **aucun DELETE**, uniquement des
  UPDATE d'imputation et des INSERT de ventilations, comme aujourd'hui.

## Migration BDD

Une seule colonne, nullable, backfill implicite (les vieux runs restent
`NULL` = « inconnu ») :

```sql
ALTER TABLE sync_runs ADD COLUMN remaining INTEGER;
```

Convention projet (cf. AGENTS.md « libsql / Turso ») : colonne **nullable**,
ajoutée dans la migration `auth/schema.ts` (qui tourne après le
`CREATE TABLE IF NOT EXISTS`), définition complète au `CREATE TABLE` de
`business-schema.ts` pour les BDDs vierges. Pas de `NOT NULL DEFAULT`, pas
d'index sur cette colonne.

## Interfaces impactées

- `SyncCycleResult` (sync-cycle.ts) : ajout `remaining: number`.
- `SyncStatusPayload` / `SyncRunRow` (use-sync-status.ts) : ajout
  `remaining: number | null` sur `last_run`.
- Route `POST /api/sync/run` : passthrough (le corps est déjà le
  `SyncCycleResult`, `remaining` suit automatiquement).
- Route `GET /api/sync/status` / `getSyncStatus` : expose
  `last_run.remaining`.
- Nouveau module pur `web/src/lib/services/concurrency.ts`
  (`mapWithConcurrency`).

## Constantes

| Constante | Valeur | Emplacement |
|---|---|---|
| `MAX_DETAIL_FETCHES_PER_CYCLE` (K) | `12` | sync-cycle.ts |
| `DETAIL_FETCH_CONCURRENCY` (pool) | `4` | sync-cycle.ts |
| Garde-fou drainage (cycles sans progrès) | `2` | use-sync-status.ts |

## Tests

- **`mapWithConcurrency`** (pur) : respecte la limite de concurrence
  (jamais > N en vol, vérifié via compteur), préserve l'ordre des résultats,
  isole les rejets (une entrée en erreur n'annule pas les autres),
  cas liste vide, cas limite ≥ longueur.
- **Plafond dans `runSyncCycle`** (via options injectables, `file::memory:`) :
  - Avec 20 cwId à enrichir et K=12 (injecté ou constante), un cycle appelle
    **exactement 12** `scrapeDetail` (spy) et renvoie `remaining === 8`.
  - Priorité : avec 1 promotion + 1 import + 15 updates et K=2, les 2 fetchés
    sont la promotion puis l'import (ordre de priorité respecté).
  - Deletions/suggestions/transfers s'exécutent **intégralement** même quand
    `toProcess` est tronqué (compteurs inchangés vs sans plafond).
  - Convergence : deux cycles enchaînés sur 20 écritures (K=12) →
    `remaining` 8 puis 0, aucune écriture retraitée (fetch total = 20, pas 32).
  - Les liaisons de promotion au-delà de K sont **posées** (status mirror,
    comptaweb_ecriture_id) même si non enrichies ce cycle.
- **Pool dans `runSyncCycle`** : les `scrapeDetail` retenus sont bien invoqués
  (comptage), un échec de fetch n'empêche pas les autres d'être appliqués.
- **Auto-drainage** (`use-sync-status.ts`) : test de la logique de
  ré-enchaînement — `remaining>0` déclenche un second POST `force=1` ;
  `remaining===0` déclenche `router.refresh()` ; 2 cycles sans progrès
  stoppent la boucle. (Testé au niveau d'une fonction pure extraite
  `shouldDrainAgain(prevRemaining, nextRemaining, noProgressCount)` pour
  éviter de monter le hook complet.)

## Garde-fous / risques

- **Charge CW** : pool 4 + K 12 = au plus 4 requêtes simultanées, 12 par
  cycle. Douces pour Comptaweb. Le drainage enchaîne les cycles mais jamais en
  parallèle (verrou `already_running`).
- **Page fermée pendant le drainage** : si l'utilisateur ferme l'onglet, le
  drainage s'arrête ; il reprendra au prochain mount (stale) ou au prochain
  clic. Acceptable — la sync converge sur plusieurs sessions, aucune donnée
  perdue.
- **Pas de régression sur le cas mono/petit** : si `|toProcess| ≤ K`, le cycle
  se comporte exactement comme avant (remaining=0, un seul run), à la
  parallélisation près.
