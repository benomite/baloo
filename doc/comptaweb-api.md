# Feature — Client API Comptaweb

**Statut** : cadrée, discovery #1 faite (2026-04-18) — prochain jalon = implémentation du client TS (auth + lecture écritures bancaires non rapprochées)
**Dernière mise à jour** : 2026-04-18

---

## Objectif

Permettre à Baloo d'**écrire directement dans Comptaweb** (et de le lire) sans passer par l'export CSV manuel ou l'automation navigateur. Cible : supprimer la double saisie entre la compta opérationnelle (baloo-compta SQLite) et la compta officielle (Comptaweb).

À la fin, Baloo sait :
- **Lire** les écritures Comptaweb (vue gestion courante recettes/dépenses) et les référentiels (unités, catégories, modes de paiement, activités).
- **Créer** une écriture de type dépense ou recette (simple ou ventilée).

Pas plus.

## Scope

### Dans le scope

- **Lecture** : écritures de gestion courante (recettes + dépenses), **écritures bancaires non rapprochées avec sous-lignes DSP2 enrichies** (ajouté par [ADR-012](decisions.md)), référentiels nécessaires pour créer une écriture.
- **Écriture** : création d'une écriture de dépense, création d'une écriture de recette, avec leurs ventilations éventuelles.
- **Authentification** : login utilisateur sur l'instance Comptaweb du groupe (flow Keycloak OIDC + PKCE), persistance du cookie/token pour éviter de se relogger à chaque appel.

### Hors scope (explicitement)

| Non inclus | Pourquoi |
|---|---|
| **Suppression** d'une écriture | Risque destructeur trop élevé. On ne supprime **jamais** depuis Baloo — toujours manuellement dans Comptaweb. |
| **Modification** d'une écriture existante | Idem. Modification = via l'UI Comptaweb. |
| **Rapprochement bancaire** | Process complexe, métier, non adapté à l'automation en phase 1. |
| **Administration** (utilisateurs, configuration, comptes, paramétrage) | Hors usage quotidien. Laissé à l'UI Comptaweb. |
| **Autres modules Comptaweb** (bilan, budgets, clôture annuelle, etc.) | Hors besoin opérationnel du trésorier pour l'instant. |

Cette liste est **normative** : même si un endpoint de suppression est découvert pendant la phase discovery, il ne doit **jamais** être exposé côté client. Le client lève explicitement une erreur si on tente d'y accéder.

## Approche technique

Reverse engineering du trafic HTTP de Comptaweb depuis le navigateur, puis écriture d'un client TypeScript minimal intégré au MCP `baloo-compta` existant (dossier `compta/`).

**Précision post-discovery #1 (2026-04-18, cf. [ADR-012](decisions.md))** : Comptaweb est une **webapp server-rendered** (jQuery + Bootstrap + DataTables), **pas une SPA** avec API JSON. Le client TS parse donc du HTML via `cheerio` (nouvelle dépendance prod), et les soumissions sont des formulaires `application/x-www-form-urlencoded`. La cartographie précise des endpoints et sélecteurs vit dans [`comptaweb-api-endpoints.md`](comptaweb-api-endpoints.md).

Alternative écartée : automation navigateur (Playwright / Claude in Chrome) sur le DOM avec un vrai browser. Plus fragile (exécute le JS client, nécessite un browser en plus), plus lent, plus difficile à tester. Le scraping HTTP + `cheerio` est plus léger et suffit tant que la page n'exige pas de JS pour se rendre (ce qui est le cas ici).

### Phase 1 — Discovery (1 à 2 sessions)

**Objectif** : cartographier les endpoints utilisés par l'UI Comptaweb pour les opérations dans le scope.

**Méthode** :
1. L'utilisateur lance Comptaweb dans Chrome, Baloo observe le trafic via `mcp__claude-in-chrome__read_network_requests`.
2. Parcours guidé des écrans :
   - **Login** — identifier le flow d'auth (form POST classique ? OAuth ? endpoint JSON ?), le mécanisme de session (cookie `JSESSIONID` ? token dans un header ?), et le CSRF token éventuel.
   - **Liste des écritures** — vue "gestion courante" recettes + dépenses, identifier les paramètres de filtre (période, unité, type).
   - **Détail d'une écriture** — champs retournés, structure des ventilations.
   - **Création d'une dépense** — schéma du body, champs obligatoires vs facultatifs, validation côté serveur.
   - **Création d'une recette** — idem.
   - **Lecture des référentiels** — unités, catégories (natures), modes de paiement, activités. Les endpoints peuvent être partagés entre les écrans ou dédiés.
3. Pour chaque endpoint, consigner : URL, méthode, headers d'auth, schéma body, schéma réponse, codes d'erreur observés.
4. Test de reproduction avec `curl` hors navigateur pour confirmer que l'auth capturée fonctionne en dehors de Chrome.

**Livrable** : [`doc/comptaweb-api-endpoints.md`](comptaweb-api-endpoints.md) listant les endpoints cartographiés avec leurs schémas. **Créé le 2026-04-18** après la session discovery #1. Données anonymisées (placeholders pour IDs et libellés).

### Phase 2 — Client TypeScript (1 à 2 sessions)

**Objectif** : un module `compta/src/comptaweb-client/` qui expose des fonctions typées pour les opérations du scope.

**Structure envisagée** :

```
compta/src/comptaweb-client/
├── auth.ts              ← login, persistance du token/cookie, refresh
├── http.ts              ← wrapper fetch avec injection d'auth, gestion d'erreurs
├── ecritures.ts         ← list_ecritures, get_ecriture, create_depense, create_recette
├── referentiels.ts      ← list_unites, list_categories, list_modes_paiement, list_activites
├── types.ts             ← interfaces TypeScript pour requests/responses
└── index.ts             ← export public du client
```

**Principes** :
- **Zéro endpoint dangereux exposé.** Pas de fonction `delete_ecriture`, pas de fonction `update_ecriture`, pas de fonction `reconcile_*` ou `admin_*`. Si un endpoint de ce type est découvert en phase 1, il est documenté pour info mais pas wrappé.
- **Typage strict** sur tout ce qui entre et sort du client. Les schémas sont définis dans `types.ts` à partir des observations phase 1.
- **Persistance du cookie/token** dans un fichier local gitignored (par défaut `data/comptaweb-session.json`) pour éviter de se relogger à chaque appel MCP.
- **Gestion des sessions expirées** : si un appel retourne 401, tenter un re-login silencieux une fois, puis échouer proprement.
- **Pas de retry automatique sur écriture.** Une tentative qui échoue doit remonter l'erreur brute — pas de risque de double création.

### Phase 3 — Intégration MCP (0.5 session)

**Objectif** : exposer les opérations via le serveur MCP `baloo-compta`.

**Nouveaux outils MCP proposés** :
- `cw_login` — authentification initiale (interactive, demande identifiants une fois).
- `cw_list_ecritures` — lecture, avec filtres période/unité/type.
- `cw_get_ecriture` — détail d'une écriture.
- `cw_list_referentiels` — lecture consolidée des référentiels (unités, catégories, modes, activités).
- `cw_create_depense` — création d'une dépense. Demande confirmation explicite avant POST (dry-run par défaut ?).
- `cw_create_recette` — création d'une recette. Idem.

**Pattern de sécurité** : chaque outil d'écriture supporte un paramètre `dry_run: boolean` (défaut `true`). En dry-run, le client construit la requête, la logue, mais n'appelle pas l'API. L'utilisateur doit explicitement passer `dry_run: false` pour écrire. Ça donne une couche de protection contre les hallucinations LLM.

### Phase 4 — Synchronisation baloo-compta ↔ Comptaweb

- **Écritures sortantes** (✅ livré 2026-04-19) : tool `cw_sync_draft` — un draft local passe en `saisie_comptaweb` après création de l'écriture côté Comptaweb. Dry-run par défaut. Bloque si validation échoue (nature / activité / unité / mode / justif attendu).
- **Référentiels** (✅ livré 2026-04-22, cf. [ADR-015](decisions.md)) : tool `cw_sync_referentiels` + bouton « Synchroniser les configs » sur `/import`. Pull additif des 4 référentiels (branches/projets → `unites`, natures → `categories`, activités → `activites`, modes de transaction → `modes_paiement`), match par `comptaweb_id` puis par nom normalisé, INSERT sinon. Orphelines signalées, jamais supprimées.
- **Écritures entrantes** (via CSV pour l'instant) : `import_comptaweb_csv` depuis un export manuel. Remplacement par un pull API reste à faire, non prioritaire tant que l'export CSV reste simple.

## Dépendances et inconnues

### Dépendances

- **Accès utilisateur Comptaweb** du trésorier (déjà disponible).
- **Chrome MCP** pour la phase discovery (déjà configuré, cf. `mcp__claude-in-chrome__*`).
- **`fetch` natif Node 18+** — suffisant pour le HTTP, pas besoin de dépendance HTTP lourde.
- **`cheerio`** — parseur HTML server-side, ajouté suite à la discovery #1 (cf. [ADR-012](decisions.md)). Nécessaire puisque Comptaweb est server-rendered et renvoie du HTML, pas du JSON.

### Inconnues levées par la discovery #1 (2026-04-18)

- **Mécanisme d'auth** → **Keycloak OIDC + PKCE** (realm `sgdf_production`, client `Comptaweb`). Pas de CSRF token dans les formulaires. Cookie session httpOnly côté `sirom.net`.
- **Stabilité des URLs** → URLs propres et stables (`/rapprochementbancaire?m=1`, `/recettedepense/creer`, etc.). Pas d'ID de session ni de timestamp dans les URLs observées.
- **API JSON interne** → **aucune**. Scraping HTML nécessaire (cf. ADR-012).

### Inconnues encore à lever

- **Upload de justificatif** : le formulaire de création d'écriture est en `urlencoded` (pas de champ file). Écran d'attachement de pièce justificative à cartographier dans une discovery #2.
- **Sémantique du champ `choix`** dans le formulaire de rapprochement : 3 valeurs radio observées, signification à confirmer (probable : rapprocher / ignorer / …).
- **Rate limiting** : non testé côté Comptaweb.
- **Comportement sur session expirée** : redirection 302 vers Keycloak attendue, à vérifier à l'impl pour savoir comment rafraîchir silencieusement.
- **Versioning** : aucun mécanisme de versioning d'API (il n'y a pas d'API formelle). Les changements HTML côté Comptaweb nous exposent à des cassures silencieuses → mitigation par tests d'intégration en lecture (cf. risques).

### Protocole de test (décidé 2026-04-17)

Il n'y a **pas d'environnement de staging Comptaweb** accessible. Tous les tests d'écriture se feront donc **directement en production** sur le compte réel du groupe utilisateur. Conséquences :

- Chaque test d'écriture réelle crée une **écriture jetable** clairement identifiable (ex. intitulé `TEST BALOO — à supprimer`, montant faible genre 0,01 €).
- La suppression de ces écritures de test est faite **manuellement par l'utilisateur dans l'UI Comptaweb** — jamais par le client (qui ne saura pas supprimer, par design).
- Tant que la phase discovery n'est pas terminée et que le dry-run n'a pas été validé sur plusieurs cas, aucune écriture "utile" réelle n'est poussée par Baloo.
- Les tests de lecture peuvent se faire librement sur les données réelles du groupe (sans risque d'écriture).

### Risques

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Comptaweb change son API, notre client casse | Moyenne | Élevé (bloque la saisie auto) | Tests d'intégration quotidiens (en lecture seule) qui alertent si un endpoint change de schéma. Fallback sur la saisie manuelle. |
| Double création accidentelle d'une écriture (bug ou hallucination) | Moyenne | Élevé (pollution compta) | Dry-run par défaut. Confirmation explicite. Pas de retry auto sur écriture. Idempotence côté baloo-compta (marquer l'écriture comme "poussée vers Comptaweb"). |
| Blocage de compte pour comportement automatisé | Faible | Élevé (perte d'accès) | User-agent réaliste, pas de polling agressif, rate limit côté client (max N appels/minute). |
| Capture accidentelle de données sensibles (RIB, données mineurs) dans les logs de discovery | Moyenne | Élevé (RGPD) | Scrubber les logs phase 1 avant de les commiter. Ne **jamais** commiter les payloads bruts dans `doc/`. Si on conserve des exemples, les anonymiser. |
| Volonté nationale SGDF / CGU | Inconnue | Inconnue | L'utilisateur a choisi de ne pas traiter ce point pour l'instant. À ré-ouvrir si un jour Baloo est distribué à d'autres groupes. |

## Checklist d'avancement

- [x] Discovery : login cartographié (Keycloak OIDC + PKCE)
- [x] Discovery : liste des écritures de gestion courante cartographiée
- [x] Discovery : écritures bancaires non rapprochées cartographiées (avec sous-lignes DSP2)
- [x] Discovery : création d'une dépense cartographiée (structure formulaire + ventilations)
- [x] Discovery : référentiels cartographiés (embarqués dans la page `/recettedepense/creer`)
- [ ] Discovery : upload de justificatif (écran à trouver)
- [ ] Discovery : sémantique du `choix` dans le rapprochement
- [x] Client TS : module `auth.ts` fonctionnel avec session persistée (2026-04-19)
- [x] Client TS : lecture des écritures bancaires non rapprochées fonctionnelle
- [x] Client TS : création d'une écriture (dépense / recette) avec ventilations, dry-run par défaut (2026-04-19)
- [x] Client TS : sync additive des référentiels (ADR-015, 2026-04-22)
- [x] MCP : `cw_list_rapprochement_bancaire` exposé
- [x] MCP : `cw_scan_drafts` + `cw_sync_draft` exposés (workflow d'enrichissement depuis les lignes bancaires)
- [x] MCP : `cw_create_depense` / `cw_create_recette` exposés avec dry-run
- [x] MCP : `cw_sync_referentiels` exposé + bouton web « Synchroniser les configs » sur `/import`
- [x] Front : workflow drafts `/ecritures` (colonne À compléter, statut justif 4 états cf. ADR-014, boutons Scanner/Synchroniser)
- [ ] Client TS : upload de justificatif (dépend discovery)
- [x] Doc mise à jour (endpoints, README, ADR-011 à ADR-015)

## Liens

- [ADR-007](decisions.md) — Outil compta unifié, Compta-Web reste maître
- [ADR-010](decisions.md) — SQLite + MCP Node/TypeScript
- [ADR-011](decisions.md) — Client API Comptaweb (reverse engineering)
- [ADR-012](decisions.md) — Scraping HTML avec cheerio, extension lecture lignes bancaires
- [ADR-014](decisions.md) — Flag `justif_attendu` sur les écritures (modèle des 4 états)
- [ADR-015](decisions.md) — Sync additive des référentiels Comptaweb
- [`comptaweb-api-endpoints.md`](comptaweb-api-endpoints.md) — cartographie détaillée des endpoints
- [roadmap.md](roadmap.md) — Phase 2
