# Spec — Réconciliation Comptaweb (sync miroir bidirectionnel descendant)

**Date** : 2026-06-01
**Statut** : **livré + déployé prod** (2026-06-01). Décision : [ADR-035](../decisions.md#adr-035--réconciliation-comptaweb--miroir-descendant-continu). Plan : [`../plans/2026-06-01-sync-reconciliation.md`](../plans/2026-06-01-sync-reconciliation.md).
**Révise** : [ADR-032](../decisions.md#adr-032--sync-incrémentale-comptaweb-client-piloté) (Phase 2 sync incrémentale). Le cadre client-piloté, le throttle/verrou par groupe et la table `sync_runs` sont **conservés** ; la logique interne du cycle (`runSyncCycle`) est **réécrite**.

> **Écarts vs ce design (dogfood prod, voir « Correctifs post-mise en prod » dans ADR-035)** :
> - La **catégorie** (nature → `category_id`), notée « hors scope » plus bas, a finalement été **incluse** (lue dans la ventilation détail).
> - Le scraper détail ne fait **pas** du matching libellé/valeur mais parse le **tableau de ventilation en colonnes** de `/recettedepense/<id>/afficher`. `/modifier` est inexploitable (500).
> - `needsDetail` se déclenche aussi quand l'**imputation est vide** (pas seulement au changement de signature), pour réparer le legacy.
> - 4 bugs corrigés (flag `comptaweb_synced`, `categories` sans `group_id`, résilience des résolveurs, scraper) + 2 boutons front (« Tout resynchroniser » exercice, « Resync Comptaweb » par écriture).

---

## Contexte

La sync Phase 2 (ADR-032) fait une seule chose : promouvoir `pending_sync → mirror` quand une écriture poussée par Baloo réapparaît dans la liste CW, et maintenir des drafts orphelins depuis les lignes bancaires. **Une fois en `mirror`, une écriture n'est plus jamais resynchronisée**, et la sync ne regarde jamais les suppressions côté CW.

Or l'usage réel veut un **miroir continu** où Comptaweb est la source de vérité et où la liste Baloo se réaligne en permanence :

- Les infos saisies/modifiées dans CW (activité, branche/couleur, catégorie, montant, intitulé…) doivent remonter dans Baloo.
- Une écriture supprimée dans CW doit apparaître côté Baloo comme une ligne en erreur / à traiter.
- Une écriture saisie directement dans CW (sans équivalent Baloo) doit être importée pour que les deux listes coïncident.

## Objectifs

1. **Mise à jour descendante** : une écriture `mirror` dont les champs comptables ont changé dans CW est réalignée côté Baloo (CW écrase).
2. **Détection des suppressions** : une écriture Baloo disparue de CW, *dans la plage réellement couverte par le scrape*, passe en `supprimee_cw` (file d'arbitrage, jamais de DELETE auto).
3. **Import des écritures CW absentes** : une ligne CW sans équivalent Baloo est créée en `mirror`.
4. **Réconciliation des drafts locaux** : un draft Baloo (issu d'une ligne bancaire) que l'utilisateur a aussi saisi dans CW est relié et promu `mirror` quand le match est certain ; sinon une suggestion de lien est proposée.
5. **Préservation stricte des enrichissements Baloo** : notes, justificatifs, liens dépôts/remboursements ne sont jamais touchés par la sync.
6. **Aucune sync interminable** : l'enrichissement activité (page détail CW, 1 requête/écriture) est **incrémental**.

## Non-objectifs

- **Résolution automatique des conflits** : on aligne (CW écrase) ou on signale (`supprimee_cw`, suggestion de lien), mais l'arbitrage des suppressions et des liens ambigus reste manuel.
- **Bidirectionnel montant** : Baloo ne pousse pas de modifications vers CW dans cette spec (le push reste l'existant `createEcritureAndPushToCw`). La sync est descendante (CW → Baloo).
- **Cron / pré-warming** : inchangé, sync client-piloté + MCP (ADR-032).
- **Refonte UI complète de `/ecritures`** : on ajoute le rendu des statuts `supprimee_cw` et des suggestions de lien, pas une refonte.

---

## Modèle de réconciliation

Un cycle = `reconcile(snapshotCW, écrituresBaloo)` sur une **fenêtre**. CW est source de vérité.

### Fenêtre et scope

- **Défaut `scope='recent'`** : la liste `GET /recettedepense?m=1` (période active CW, en pratique les écritures récentes / le mois courant). C'est le scope des cycles automatiques (client + MCP).
- **`scope='exercice'`** : la liste de l'exercice complet (déclenché explicitement : `sync_run({ scope: 'exercice' })` ou bouton dédié). Plus lourd, pas dans le cycle auto.

> Note d'impl : le scraper liste accepte un paramètre de scope. Le filtrage exact côté CW (`?m=1` vs paramètre d'exercice) est à confirmer au plan ; à défaut, `exercice` itère mois par mois.

### Plage couverte et sécurité des suppressions

La détection de suppression ne doit jamais confondre « supprimée dans CW » et « hors de la fenêtre scrapée » (cas d'une écriture dont la **date a changé** et qui sort de la vue).

Règle : on borne par **id interne CW** (`comptaweb_ecriture_id`), qui est stable même si la date change.

- `plageCouverte = [minId, maxId]` = bornes des ids CW présents dans le snapshot.
- Une écriture Baloo (`mirror` / `pending_sync`) est déclarée `supprimee_cw` **seulement si** son `comptaweb_ecriture_id` ∈ `[minId, maxId]` **et** absente du snapshot.
- Si `comptaweb_ecriture_id < minId` (plus ancienne que la plus vieille vue) → hors fenêtre, **intouchée**.
- En `scope='exercice'`, la plage couvre tout → toute écriture liée mais absente = supprimée.

Une écriture Baloo sans `comptaweb_ecriture_id` (jamais reliée à CW : draft pur) n'est jamais candidate à `supprimee_cw`.

### Clé de jointure

`comptaweb_ecriture_id` (id interne CW extrait du href `/recettedepense/<id>/afficher`). Déjà utilisé comme clé d'idempotence forte par `caisse-sync.ts`.

- **Backfill** : au premier run, les écritures dont `comptaweb_ecriture_id IS NULL` mais `cw_numero_piece` est un entier (Phase 1 y stockait `String(id)`) reçoivent `comptaweb_ecriture_id = CAST(cw_numero_piece AS INTEGER)`.
- `cw_numero_piece` conserve son rôle d'affichage (texte `ECR-2026-N`).

---

## Étapes d'un cycle (ordre impératif)

```
1. shouldSkip (throttle 15 min + verrou 60 s) — inchangé (ADR-032)
2. INSERT sync_runs(running)
3. backfillComptawebEcritureId(groupId)            ← une fois suffit, idempotent
4. scrape liste (scope) → snapshot CW + plageCouverte
5. matchByStableKey   : mirror/pending_sync ↔ snapshot par comptaweb_ecriture_id
6. matchDrafts        : drafts ↔ lignes CW restantes par contenu (garde-fou unicité)
7. updateMirrors      : pour chaque écriture matchée → CW écrase champs comptables
                        + détail incrémental (activité / branche→unité)
8. detectDeletions    : écriture liée ∈ plageCouverte mais absente → supprimee_cw
9. importAbsent       : lignes CW restantes (non matchées) → création mirror + détail
10. detectStalePendingSync (warning) — inchangé
11. UPDATE sync_runs(ok, counts…)
```

### 5. Match par clé stable

`mirror` et `pending_sync` ayant un `comptaweb_ecriture_id` sont reliés à la ligne CW de même id. Match certain (id stable) → pas de divergence d'identité possible.

### 6. Match des drafts (contenu, sans clé stable)

Un `draft` issu d'une ligne bancaire n'a pas de `comptaweb_ecriture_id`. CW n'expose **aucun lien ligne-bancaire ↔ écriture** une fois le rapprochement fait (seules les listes de *non-rapprochés* sont disponibles). Le lien ne peut donc se faire que par **contenu**.

- Critère : `(montant_cents, type)` **exact** + `date` à **tolérance ± N jours** (N à fixer au plan, défaut 3 — la date d'opération bancaire peut décaler de la date d'écriture).
- **Garde-fou unicité** : auto-lien uniquement si **exactement un** draft et **une** ligne CW (encore non matchée) partagent le critère.
  - Match unique → draft promu `mirror`, `comptaweb_ecriture_id` posé, copie de tous les champs CW + détail.
  - Ambigu (≥ 2 candidats d'un côté ou de l'autre) → **aucun auto-lien, aucun import** de ces lignes : on crée une **suggestion de lien à confirmer** (table `cw_link_suggestions`, cf. plus bas). Le draft reste `draft`, la ligne CW reste non importée jusqu'à arbitrage.

> L'ordre (drafts avant import) garantit qu'une ligne CW correspondant à un draft n'est pas importée en double.

### 7. Mise à jour des mirror (CW écrase)

Pour chaque écriture matchée (clé stable ou draft fraîchement promu) :

**Champs comptables — CW écrase (overwrite franc)** :
`date_ecriture`, `description` (intitulé), `amount_cents`, `type`, `numero_piece`/`cw_numero_piece`, `mode_paiement_id` (mappé depuis `modeTransaction`), `category_id` (mappé depuis catégorie/nature), `activite_id`, `unite_id`.

**Champs Baloo-locaux — jamais touchés** :
`notes`, `justif_attendu`, justificatifs attachés, liens `depots_justificatifs` / `remboursements` / `abandons_frais`.

**Détail incrémental** : on lit la page détail CW (`scrapeEcritureDetail`) seulement si l'une des conditions est vraie :
- la **signature liste** a changé (`cw_signature` ≠ hash recalculé), ou
- `activite_id IS NULL` ou `unite_id IS NULL`, ou
- c'est un nouvel import / une promotion de draft.

`cw_signature` = hash stable de `(date, montant, type, intitulé, numéroPièce, modeTransaction, catégorieTiers)`. Stockée en colonne. Évite N requêtes détail au régime permanent.

Mapping détail : `activite` CW → `activite_id` (match par `comptaweb_id` puis nom) ; `brancheprojet` CW → `unite_id` (match par `comptaweb_id`/`branche` ; porte la couleur via `unites.couleur`).

> À confirmer au plan côté CW : que `brancheprojet` porte bien la couleur/unité (hypothèse retenue). Si c'est l'activité, le mapping s'inverse — sans impact sur l'architecture.

### 8. Détection des suppressions

Cf. « Plage couverte ». Écriture liée ∈ plage mais absente du snapshot → `status = 'supprimee_cw'`. Jamais de DELETE. `updated_at` mis à jour. Compteur `supprimee_cw_detected`.

### 9. Import des écritures CW absentes

Lignes CW du snapshot restées non matchées (ni clé stable, ni draft confiant, ni suggestion) → création d'une écriture `mirror` : `comptaweb_ecriture_id` posé, champs liste copiés, `cw_signature` calculée, détail lu pour activité/unité. Compteur `imported_from_cw`.

Coordination avec `scanDraftsFromComptaweb` (drafts depuis lignes bancaires non rapprochées) : la **liste CW** devient la source primaire des *écritures* CW ; le scan des lignes bancaires reste la source des *mouvements bancaires sans écriture*. Une ligne bancaire déjà écrituré et rapprochée n'apparaît plus dans `listRapprochementBancaire` → pas de double création. Reste le cas d'une ligne bancaire écrituré mais **non encore rapprochée** : elle peut produire à la fois un draft (scan) et une écriture importée (liste). Mitigation : le match drafts (étape 6) tourne avant l'import et absorbe ce cas dès que le draft existe. Détaillé au plan.

---

## Statuts

Enum écritures (pas de CHECK SQL, validation côté code — AGENTS.md) :

| Statut | Sens |
|---|---|
| `draft` | local, jamais poussé |
| `pending_cw` | en cours d'envoi |
| `pending_sync` | poussé, attend la promotion |
| `mirror` | synced, miroir CW propre |
| `divergent` | match **heuristique faible-confiance** d'un `pending_sync` (montant/type ne concorde pas) — garde-fou anti-mismatch, arbitrage manuel |
| `supprimee_cw` | **(nouveau)** était reliée à CW, a disparu de CW dans la plage couverte — file d'arbitrage |

`divergent` n'est **plus** produit pour les mirror matchés par clé stable (CW écrase franc, l'id garantit que c'est la même écriture).

### Transitions ajoutées

- `mirror` / `pending_sync` → `supprimee_cw` (détection suppression).
- `draft` → `mirror` (promotion par match contenu confiant).
- `supprimee_cw` → `draft` (arbitrage : l'utilisateur restaure en local) ou suppression définitive (garde-fous `deleteDraftEcriture` : aucune pièce attachée).

Module pur `ecritures-sync-transitions.ts` (testable sans BDD), sur le modèle de `remboursements-transitions.ts`.

---

## File d'arbitrage et suggestions de lien (UI)

### Suppressions (`supprimee_cw`)

Dans `/ecritures` : badge rouge + section/filtre « À arbitrer ». Actions par écriture :
- **Supprimer définitivement** : seulement si aucune pièce attachée (réutilise les garde-fous `deleteDraftEcriture`). Sinon action désactivée avec explication.
- **Restaurer en brouillon** : repasse `draft` (l'utilisateur la re-poussera dans CW si besoin).
- **Ignorer** : laisse en `supprimee_cw` (signal persistant).

### Suggestions de lien (`cw_link_suggestions`)

Nouvelle table (audit + UI) :

```
cw_link_suggestions(
  id TEXT PK, group_id TEXT,
  ecriture_id TEXT,                 -- le draft Baloo candidat
  cw_ecriture_id INTEGER,           -- la ligne CW candidate
  cw_numero_piece TEXT, cw_montant_cents INTEGER, cw_date TEXT, cw_intitule TEXT,
  status TEXT DEFAULT 'a_confirmer', -- a_confirmer | confirme | rejete
  created_at TEXT, resolved_at TEXT
)
```

UI : encart « Liens à confirmer » dans `/ecritures`. Action **Confirmer** → promeut le draft en `mirror` (pose `comptaweb_ecriture_id`, copie CW, détail), marque la suggestion `confirme`. Action **Rejeter** → `rejete` (la ligne CW sera importée au cycle suivant comme écriture distincte).

Pas de DELETE sur cette table (UPSERT / update de `status`). Une suggestion déjà `confirme`/`rejete` n'est pas recréée.

---

## Audit `sync_runs`

Colonnes ajoutées (toutes nullable, défaut 0) :

- `updated_mirror` — mirror réalignés depuis CW
- `supprimee_cw_detected` — suppressions détectées ce cycle
- `imported_from_cw` — écritures créées depuis la liste CW
- `link_suggestions_created` — suggestions de lien créées
- `detail_fetches` — pages détail lues (coût)
- `scope` — `recent` | `exercice`

`promoted_to_mirror` conservé (drafts + pending_sync promus). `new_drafts` / `updated_drafts` conservés.

---

## Composants à construire / modifier

| Élément | Type | Détail |
|---|---|---|
| `comptaweb/ecriture-detail-scrape.ts` | **nouveau** | `scrapeEcritureDetail(config, id)` → `{ activite, brancheprojet, ventilations? }`. Parse `/recettedepense/<id>/afficher`. Fixture HTML synthétique + locale gitignored. |
| `comptaweb/ecritures-list-scrape.ts` | modif | paramètre de scope ; expose `minId`/`maxId` (ou calculés côté cycle). |
| `services/sync-cycle.ts` | **réécriture** | `runSyncCycle` → modèle réconciliation. Sous-fonctions pures extraites et testées isolément. |
| `services/ecritures-sync-reconcile.ts` | **nouveau** | logique pure de diff `reconcile(snapshot, balooRows, plage)` → `{ toUpdate, toDelete, toImport, draftMatches, ambiguous }`. Sans BDD ni HTTP → 100 % testable. |
| `services/ecritures-sync-transitions.ts` | **nouveau** | guards de transition purs. |
| `services/cw-link-suggestions.ts` | **nouveau** | CRUD suggestions (UPSERT, pas de DELETE). |
| `db/business-schema.ts` + migration | modif | `cw_signature`, colonnes `sync_runs`, table `cw_link_suggestions`, backfill `comptaweb_ecriture_id`. |
| `mcp/tools/sync.ts` | modif | `sync_run({ force?, scope? })` ; counts enrichis dans la sortie. |
| `app/(app)/ecritures/*` + composants | modif | rendu `supprimee_cw`, actions d'arbitrage, encart suggestions de lien. |
| `lib/actions/ecritures-arbitrage.ts` | **nouveau** | server actions : supprimer / restaurer / ignorer / confirmer-lien / rejeter-lien. |

---

## Migration BDD (cold start prod)

Idempotente, pattern `business-schema.ts` + `auth/schema.ts` (cf. AGENTS.md « CREATE INDEX après ALTER ») :

1. `ALTER TABLE ecritures ADD COLUMN cw_signature TEXT;` (nullable).
2. `sync_runs` : `ALTER … ADD COLUMN updated_mirror INTEGER DEFAULT 0;` (+ `supprimee_cw_detected`, `imported_from_cw`, `link_suggestions_created`, `detail_fetches`, `scope TEXT`).
3. `CREATE TABLE IF NOT EXISTS cw_link_suggestions (…)` + index `(group_id, status)` **après** le CREATE TABLE.
4. Backfill `comptaweb_ecriture_id` depuis `cw_numero_piece` numérique (UPDATE ciblé, COALESCE — n'écrase pas un id déjà posé).
5. Pas de CHECK sur `status` → `supprimee_cw` ne demande aucune migration de table.

---

## Tests (cibles)

- **`ecritures-sync-reconcile` (pur)** : diff exhaustif — update, delete dans/hors plage, import, draft match unique, draft match ambigu, backfill, plage vide, scope exercice.
- **`ecriture-detail-scrape`** : parse activité + brancheprojet (fixture synthétique + locale).
- **`ecritures-sync-transitions`** : transitions autorisées/interdites.
- **`sync-cycle`** : intégration orchestrée (mocks scraper/config), counts `sync_runs`, throttle/verrou (régression ADR-032 conservée), incrémentalité détail (signature inchangée → 0 fetch).
- **`cw-link-suggestions`** : UPSERT, pas de doublon, transitions de statut.
- **server actions arbitrage** : garde-fous suppression (pièce attachée → refus).
- **Régression** : les tests ADR-032 qui restent valides (throttle, verrou, stale, isolation multi-groupes) passent.

---

## Risques connus

- **Matching contenu des drafts** : malgré le garde-fou unicité, une collision parfaite (même montant/type/date, intitulés proches) reste possible → c'est précisément pourquoi l'ambigu va en suggestion, jamais en auto-lien.
- **Coût détail au premier run** : un premier `scope='exercice'` peut lire beaucoup de pages détail. Mitigation : incrémentalité (signatures) dès le 2e run ; `scope='exercice'` réservé au déclenchement manuel.
- **Changement de structure HTML CW** (liste ou détail) : critères de détection robustes + log via journal d'erreurs (comme l'existant).
- **`brancheprojet` vs `activite` pour la couleur** : hypothèse à confirmer au plan, sans impact architecture.
