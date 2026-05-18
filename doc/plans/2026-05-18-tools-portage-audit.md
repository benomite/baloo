# Audit portage tools compta/ → /api/mcp

Date : 2026-05-18
Phase : 1 (pivot miroir strict)
Branche : `feat/phase-1-miroir-strict`

## Méthode

- Source `compta/` : `compta/src/tools/*.ts` (24 fichiers), scan via `grep "server.tool(" *.ts`. Chaque fichier enregistre 1 à 5 tools via une fonction `register*Tools(server)`.
- Source `/api/mcp` : `web/src/app/api/mcp/route.ts` (entrée HTTP) → `web/src/lib/mcp/register-all.ts` → `web/src/lib/mcp/tools/*.ts` (3 fichiers actuellement).
- Bilan brut : **3 tools** déjà portés dans la webapp, **65 tools** dans le standalone.

Tous les tools `compta/` sont des **thin wrappers** sur des endpoints HTTP de la webapp (`api.get`/`api.post`/`api.patch`/`api.del` vers `BALOO_API_URL`). Quasi tous les endpoints HTTP cibles **existent déjà** (`web/src/app/api/*/route.ts`), ce qui rend le portage majoritairement mécanique : recopier la déclaration zod + appeler le service interne au lieu de faire un fetch HTTP intermédiaire.

## Tools déjà portés

3 tools sont actuellement enregistrés dans `/api/mcp`, tous via `registerAllTools` (web/src/lib/mcp/register-all.ts:7-11) :

- `vue_ensemble` (source: compta/src/tools/overview.ts:19 → cible: web/src/lib/mcp/tools/overview.ts:6)
- `list_ecritures` (source: compta/src/tools/ecritures.ts:18 → cible: web/src/lib/mcp/tools/ecritures.ts:7)
- `recherche` (source: compta/src/tools/recherche.ts:15 → cible: web/src/lib/mcp/tools/recherche.ts:7)

NB : la version webapp `list_ecritures` (web/src/lib/mcp/tools/ecritures.ts:7) appelle **directement** `listEcritures()` (service) avec un schéma de filtres plus restreint que celui de `compta/` (qui exposait aussi `status`, `carte_id`, `mode_paiement_id`, `comptaweb_ecriture_id`, `unmatched_only`, etc.). À considérer en Task 2 : soit on s'aligne sur le surensemble historique de filtres, soit on documente la réduction de surface (cohérente avec le pivot miroir strict où le statut prend une autre sémantique — cf. Task 5).

## Tools à porter (Task 2)

Tous les endpoints webapp listés ci-dessous existent déjà sous `web/src/app/api/<path>/route.ts`. Aucun endpoint HTTP à créer.

### Référentiels (4 tools, fichier compta/src/tools/reference.ts)

- `list_categories` (compta/src/tools/reference.ts:5)
  - Endpoint webapp : `GET /api/reference/categories` — existe.
- `list_unites` (compta/src/tools/reference.ts:10)
  - Endpoint webapp : `GET /api/reference/unites` — existe.
- `list_modes_paiement` (compta/src/tools/reference.ts:15)
  - Endpoint webapp : `GET /api/reference/modes-paiement` — existe.
- `list_activites` (compta/src/tools/reference.ts:20)
  - Endpoint webapp : `GET /api/reference/activites` — existe.

### Écritures (2 tools restants, fichier compta/src/tools/ecritures.ts)

- `create_ecriture` (compta/src/tools/ecritures.ts:43)
  - Endpoint webapp : `POST /api/ecritures` — existe.
  - **Particularité** : la Task 7 va refondre le POST `/api/ecritures` pour passer par `createEcritureAndPushToCw` (cycle `pending_cw` → `pending_sync`). Le tool MCP devra refléter cette nouvelle sémantique : "crée dans CW via scraping puis miroir en BDD". À porter **après** Task 7, ou prévoir l'adaptation au moment du portage.
- `update_ecriture` (compta/src/tools/ecritures.ts:81)
  - Endpoint webapp : `PATCH /api/ecritures/[id]` — existe.
  - **Particularité** : avec le miroir strict, modifier une écriture en BDD locale sans la modifier dans CW casse l'invariant. À discuter : ce tool ne devrait modifier que les champs **Baloo-only** (notes locales, liens justifs/dépôts/rembs), pas les champs miroir. La Phase 1 ne traite pas le batch edit. Reformuler la description du tool en conséquence au moment du portage.

### Comptes bancaires (3 tools, fichier compta/src/tools/comptes.ts)

- `list_comptes_bancaires` (compta/src/tools/comptes.ts:14) — `GET /api/comptes-bancaires` existe.
- `create_compte_bancaire` (compta/src/tools/comptes.ts:24) — `POST /api/comptes-bancaires` existe.
- `update_compte_bancaire` (compta/src/tools/comptes.ts:44) — `PATCH /api/comptes-bancaires/[id]` existe.

### Cartes (3 tools, fichier compta/src/tools/cartes.ts)

- `list_cartes` (compta/src/tools/cartes.ts:15) — `GET /api/cartes` existe.
- `create_carte` (compta/src/tools/cartes.ts:26) — `POST /api/cartes` existe.
- `update_carte` (compta/src/tools/cartes.ts:46) — `PATCH /api/cartes/[id]` existe.

### Personnes (3 tools, fichier compta/src/tools/personnes.ts)

- `list_personnes` (compta/src/tools/personnes.ts:27) — `GET /api/personnes` existe.
- `create_personne` (compta/src/tools/personnes.ts:41) — `POST /api/personnes` existe.
- `update_personne` (compta/src/tools/personnes.ts:60) — `PATCH /api/personnes/[id]` existe.

### Notes (4 tools, fichier compta/src/tools/notes.ts)

- `list_notes` (compta/src/tools/notes.ts:11) — `GET /api/notes` existe.
- `create_note` (compta/src/tools/notes.ts:24) — `POST /api/notes` existe.
- `update_note` (compta/src/tools/notes.ts:39) — `PATCH /api/notes/[id]` existe.
- `delete_note` (compta/src/tools/notes.ts:55) — `DELETE /api/notes/[id]` existe.
  - **Vigilance** : `delete_note` est la seule opération destructive exposée par MCP. La description du tool standalone recommande "utiliser avec parcimonie, préférer update_note". À conserver. Cohérent avec CLAUDE.md (notes sont la seule table où DELETE est tolérable, contrairement aux écritures).

### Groupe (2 tools, fichier compta/src/tools/groupes.ts)

- `get_groupe` (compta/src/tools/groupes.ts:11) — `GET /api/groupe` existe.
- `update_groupe` (compta/src/tools/groupes.ts:16) — `PATCH /api/groupe` existe.

### Todos (4 tools, fichier compta/src/tools/todos.ts)

- `list_todos` (compta/src/tools/todos.ts:13) — `GET /api/todos` existe.
- `create_todo` (compta/src/tools/todos.ts:26) — `POST /api/todos` existe.
- `complete_todo` (compta/src/tools/todos.ts:41) — `POST /api/todos/[id]/complete` existe.
- `update_todo` (compta/src/tools/todos.ts:51) — `PATCH /api/todos/[id]` existe.

### Budgets (4 tools, fichier compta/src/tools/budgets.ts)

- `list_budgets` (compta/src/tools/budgets.ts:27) — `GET /api/budgets` existe.
- `create_budget` (compta/src/tools/budgets.ts:37) — `POST /api/budgets` existe.
- `create_budget_ligne` (compta/src/tools/budgets.ts:52) — `POST /api/budgets/[id]/lignes` existe.
- `list_budget_lignes` (compta/src/tools/budgets.ts:75) — `GET /api/budgets/[id]/lignes` existe.

### Caisse (4 tools, fichier compta/src/tools/caisse.ts)

- `list_mouvements_caisse` (compta/src/tools/caisse.ts:37) — `GET /api/caisse` existe.
- `cw_list_caisses` (compta/src/tools/caisse.ts:55) — `GET /api/caisse/sync` existe.
- `cw_sync_caisse` (compta/src/tools/caisse.ts:65) — `POST /api/caisse/sync` existe.
- `create_mouvement_caisse` (compta/src/tools/caisse.ts:92) — `POST /api/caisse` existe.
  - **Particularité** : la spec dit "Aucun write Comptaweb pour la caisse" — `create_mouvement_caisse` reste donc une saisie purement locale (Baloo-only, pas de miroir CW). Cohérent avec le pivot tant que CW n'expose pas d'API/scraping write caisse. La description peut rester telle quelle.

### Chèques (2 tools, fichier compta/src/tools/cheques.ts)

- `list_depots_cheques` (compta/src/tools/cheques.ts:14) — `GET /api/cheques` existe.
- `create_depot_cheques` (compta/src/tools/cheques.ts:33) — `POST /api/cheques` existe.

### Dépôts d'espèces (3 tools, fichier compta/src/tools/depots-especes.ts)

- `list_depots_especes` (compta/src/tools/depots-especes.ts:23) — `GET /api/depots-especes` existe.
- `create_depot_especes` (compta/src/tools/depots-especes.ts:41) — `POST /api/depots-especes` existe.
- `rapprocher_depot_especes` (compta/src/tools/depots-especes.ts:80) — `PATCH /api/depots-especes` existe.

### Abandons (3 tools, fichier compta/src/tools/abandons.ts)

- `list_abandons` (compta/src/tools/abandons.ts:13) — `GET /api/abandons` existe.
- `create_abandon` (compta/src/tools/abandons.ts:28) — `POST /api/abandons` existe.
- `update_abandon` (compta/src/tools/abandons.ts:58) — `PATCH /api/abandons/[id]` existe.

### Remboursements (3 tools, fichier compta/src/tools/remboursements.ts)

- `list_remboursements` (compta/src/tools/remboursements.ts:13) — `GET /api/remboursements` existe.
- `create_remboursement` (compta/src/tools/remboursements.ts:30) — `POST /api/remboursements` existe.
- `update_remboursement` (compta/src/tools/remboursements.ts:62) — `PATCH /api/remboursements/[id]` existe.

### Justificatifs (2 tools, fichier compta/src/tools/justificatifs.ts)

- `attach_justificatif` (compta/src/tools/justificatifs.ts:30) — `POST /api/justificatifs` existe.
  - **Particularité** : multipart/form-data avec lecture fichier depuis disque local (`source_path`). En MCP HTTP, le caller (Claude.ai) n'a pas accès au filesystem du serveur webapp. Deux options à arbitrer en Task 2 :
    1. Garder l'API mais changer le paramètre `source_path` → upload base64 inline du fichier (signature MCP "fichier base64").
    2. Décréter que `attach_justificatif` n'a plus de sens côté MCP HTTP, et qu'on garde uniquement le flux web (drag-and-drop UI + endpoint `/api/depots/upload`). Dans ce cas, `attach_justificatif` devient **obsolète côté MCP** (à arbitrer).
- `list_justificatifs` (compta/src/tools/justificatifs.ts:75) — `GET /api/justificatifs` existe. Pas de souci pour le portage.

### Upload orphan (1 tool, fichier compta/src/tools/upload-orphan.ts)

- `upload_justificatif_orphan` (compta/src/tools/upload-orphan.ts:22) — `POST /api/depots/upload` existe.
  - **Particularité** : même problème que `attach_justificatif` (multipart depuis filesystem local). Même arbitrage à faire en Task 2 : base64 inline ou retrait du MCP.

### Inbox (5 tools, fichier compta/src/tools/inbox.ts)

- `inbox_list_orphan_ecritures` (compta/src/tools/inbox.ts:6) — `GET /api/inbox/orphan-ecritures` existe.
- `inbox_list_orphan_justifs` (compta/src/tools/inbox.ts:25) — `GET /api/inbox/orphan-justifs` existe.
- `inbox_suggest_matches` (compta/src/tools/inbox.ts:35) — `GET /api/inbox/suggestions` existe.
- `inbox_link` (compta/src/tools/inbox.ts:58) — `POST /api/inbox/link` existe.
- `inbox_auto_match` (compta/src/tools/inbox.ts:71) — `POST /api/inbox/auto-match` existe.
  - **Vigilance** : avec le nouveau statut enum (Task 5), `inbox_list_orphan_ecritures` doit lister les `draft` + `pending_cw` + `pending_sync` (cf. Task 6 Step 6 du plan). Si on porte ce tool **avant** Task 6, prévoir une mise à jour ou un porter directement après. Recommandation : porter après Task 6.

### Comptaweb interaction (5 tools, fichier compta/src/tools/comptaweb-client.ts)

- `cw_list_rapprochement_bancaire` (compta/src/tools/comptaweb-client.ts:105) — `GET /api/comptaweb/rapprochement-bancaire` existe.
- `cw_referentiels_creer_ecriture` (compta/src/tools/comptaweb-client.ts:115) — `GET /api/comptaweb/referentiels-creer` existe.
- `cw_create_depense` (compta/src/tools/comptaweb-client.ts:125) — `POST /api/comptaweb/ecriture` existe.
  - **Particularité** : doublon fonctionnel avec `create_ecriture` (Task 7). Le nouveau modèle veut **un seul** point d'entrée création écriture qui pilote CW et fait miroir. À arbitrer en Task 2/7 : soit on garde `cw_create_depense` comme tool bas-niveau "écrire directement dans CW sans toucher la BDD Baloo" (utile pour CW seulement, ex. correction directe), soit on le **fusionne avec `create_ecriture`** (Task 7). Recommandation : retirer côté MCP, garder uniquement `create_ecriture`. Mais le considérer formellement obsolète demande validation produit — donc à porter par défaut, et marquer pour réévaluation post-Phase 1.
- `cw_create_recette` (compta/src/tools/comptaweb-client.ts:138) — `POST /api/comptaweb/ecriture` existe. Même remarque que `cw_create_depense`.
- `cw_ecriture_depuis_ligne_bancaire` (compta/src/tools/comptaweb-client.ts:151) — `POST /api/comptaweb/ecriture-from-bancaire` existe.
  - **Particularité** : workflow "enrichir une ligne bancaire détectée pour créer l'écriture CW correspondante". Très utile pour Phase 3 (dogfood). À porter.

### Sync référentiels (1 tool, fichier compta/src/tools/sync-referentiels.ts)

- `cw_sync_referentiels` (compta/src/tools/sync-referentiels.ts:58) — `POST /api/comptaweb/sync-referentiels` existe.

## Tools obsolètes (à NE PAS porter)

### `import_comptaweb_csv` (source: compta/src/tools/comptaweb.ts:14)

**Raison** : la spec Phase 5 dit `Import CSV → déplacé dans page admin cachée (onboarding tardif + correction de drift)`. Le sync incrémental (Phase 2) remplace l'import CSV comme moyen principal de récupérer les écritures CW. L'import CSV restant n'a pas besoin d'être exposé via MCP : c'est une action admin ponctuelle (premier sync d'un groupe, correction de drift), accessible via la page admin et/ou un script CLI.

Endpoint `POST /api/comptaweb/import-csv` est conservé pour la page admin ; pas de portage MCP.

### `cw_cleanup_dedup`, `cw_cleanup_orphelins`, `cw_cleanup_transferts` (source: compta/src/tools/comptaweb.ts:46, 62, 75)

**Raison** : ces tools sont des **palliatifs aux bugs d'import CSV** (cf. CLAUDE.md "Dédup et cleanup orphelins", commits `9e3475e`, `eeaf030`, `7989125`). Avec le miroir strict + sync incrémental (qui crée/UPSERT par `cw_numero_piece`), les sources de doublons et d'orphelins disparaissent en V1. Ces tools deviennent des outils de maintenance ponctuelle, à exécuter manuellement depuis la page admin si jamais un drift apparait.

Endpoints `POST /api/comptaweb/cleanup/*` conservés pour la page admin ; pas de portage MCP.

### `cw_scan_drafts` (source: compta/src/tools/scan-drafts.ts:11)

**Raison** : scan les drafts BDD pour détecter ceux **prêts à être synchronisés vers CW** (selon l'ancien modèle `brouillon` → `saisie_comptaweb`). Le nouveau modèle (Task 7) inverse le flux : on n'écrit jamais en BDD un draft "prêt à synchroniser vers CW", on écrit dans CW directement et la BDD passe `pending_cw` → `pending_sync`. Donc plus de "scan drafts à pousser".

Le concept "draft Baloo en attente d'être lié à une future écriture CW" reste valide (justifs orphelins, lignes bancaires détectées, etc.), mais il est couvert par les tools `inbox_*` qui restent portés.

Endpoint `POST /api/drafts/scan` : à conserver tant que la Phase 1 n'a pas migré le statut, puis à retirer ensemble. Hors scope Phase 1.

### `cw_sync_draft` (source: compta/src/tools/sync-draft.ts:14)

**Raison** : synchronise un draft Baloo (status `brouillon`) vers CW puis met à jour le draft en `saisie_comptaweb`. Ancien modèle. Remplacé par `createEcritureAndPushToCw` (Task 7) qui fait l'aller-retour CW dans le **même** appel POST `/api/ecritures`.

Endpoint `POST /api/drafts/[id]/sync` : à conserver tant que Phase 1 ne fige pas, puis à retirer. Hors scope.

## Notes complémentaires

### Surface tools de la version webapp `list_ecritures` réduite

Le tool webapp `list_ecritures` (web/src/lib/mcp/tools/ecritures.ts:7) accepte uniquement `type`, `date_debut`, `date_fin`, `category_id`, `unite_id`, `limit`. Le `compta/` exposait en plus : `unmatched_only`, `comptaweb_ecriture_id`, `carte_id`, `mode_paiement_id`, `status`, `description_contains`, etc.

Avec le nouveau modèle, `status` change de sémantique (Task 5) et la sélection par défaut est `mirror` only (Task 6). Au moment du portage de `create_ecriture` / `update_ecriture` (et au passage de la mise à jour de `list_ecritures`), aligner les filtres exposés sur les besoins MCP réels — pas besoin de tout porter brutalement. **Décision à acter** au moment du portage.

### Authentification : `compta/` utilisait un token BALOO_API_TOKEN, `/api/mcp` utilise OAuth

Le serveur standalone `compta/` injectait `Authorization: Bearer $BALOO_API_TOKEN` (cf. `compta/src/api-client.ts` non lu mais visible dans `justificatifs.ts:55-57`). La route MCP HTTP webapp passe par OAuth + `verifyOauthAccessToken` (web/src/app/api/mcp/route.ts:28). Le portage doit s'appuyer sur `ctx.groupId` / `ctx.scopeUniteId` extraits du token OAuth (déjà fait dans les 3 tools portés actuels), pas sur le forwarding d'un token bearer.

### Multipart uploads : trou architectural pour le MCP HTTP

Deux tools (`attach_justificatif`, `upload_justificatif_orphan`) lisent un fichier depuis le filesystem du caller. En version standalone, le caller est le MCP local qui tourne sur la même machine que Claude Desktop, donc lecture disque OK. En version webapp HTTP, le caller est distant (Claude.ai) : il n'a pas accès au filesystem du serveur webapp. **Décision à prendre en Task 2** : (a) passer le fichier en base64 inline dans le payload MCP, ou (b) considérer ces tools comme non-portables et garder l'upload uniquement via le front web. Option (b) plus simple, cohérente avec le rôle "le front gère les fichiers, le MCP gère la donnée structurée".

### Comportement transitoire pendant le portage

Tant que `compta/` standalone existe encore (jusqu'à Task 4), les deux MCPs peuvent coexister. Le user doit débrancher l'un ou l'autre selon ses tests. La doc dépréciation (Task 3) clarifiera.

### Récap chiffré

- **Total tools `compta/`** : 65
- **Déjà portés** : 3 (overview, list_ecritures, recherche)
- **À porter (Task 2)** : 56
- **Obsolètes** : 6 (`import_comptaweb_csv`, `cw_cleanup_dedup`, `cw_cleanup_orphelins`, `cw_cleanup_transferts`, `cw_scan_drafts`, `cw_sync_draft`)
- **À arbitrer en Task 2** : 2 multipart (`attach_justificatif`, `upload_justificatif_orphan`) — pourraient devenir obsolètes côté MCP si on retient l'option "front only".
- **À arbitrer en Task 2/7** : 2 doublons fonctionnels (`cw_create_depense`, `cw_create_recette`) avec le nouveau `create_ecriture` modèle miroir. Recommandation : retirer après portage de Task 7. Mais ne pas trancher dans cet audit.

3 + 56 + 6 + (2 multipart) = 67 ≠ 65 : les multipart sont **inclus** dans les 56 "à porter" en attendant l'arbitrage. Les doublons `cw_create_depense`/`cw_create_recette` sont **aussi inclus** dans les 56 à porter en attendant l'arbitrage post-Task 7. Si on bascule les uploads en obsolètes et les deux `cw_create_*` aussi, on tombe à 52 à porter et 10 obsolètes. À trancher avec le produit.
