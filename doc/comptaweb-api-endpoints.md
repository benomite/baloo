# Comptaweb — endpoints cartographiés

**Statut** : cartographie partielle issue de la session discovery du 2026-04-18 (cf. [`comptaweb-api.md`](comptaweb-api.md), [ADR-011](decisions.md) et [ADR-012](decisions.md)).
**Instance observée** : `https://sgdf.production.sirom.net/`

Ce fichier consigne les URLs, méthodes et schémas observés pour permettre l'écriture du client TypeScript. **Aucune donnée nominative ni financière réelle** n'est reproduite ici : les IDs, IBANs, libellés bancaires sont anonymisés (`<ID_COMPTE>`, `<ID_LIGNE_BANCAIRE>`, etc.).

---

## Architecture générale

Comptaweb est une **webapp server-rendered** (jQuery + Bootstrap + DataTables), **pas une SPA**. Conséquences :
- Toutes les listes arrivent dans le HTML de la page (pas d'XHR JSON séparé).
- Les DataTables sont initialisées côté client avec les données déjà présentes dans la table HTML (filtrage/pagination front-only tant qu'on ne franchit pas un seuil côté serveur).
- Les soumissions sont des **formulaires HTML classiques** (`application/x-www-form-urlencoded`).
- **Aucun token CSRF** visible dans les formulaires observés.

## Authentification

Flow **OpenID Connect + PKCE** sur Keycloak SGDF.

- Realm : `auth.sgdf.fr/auth/realms/sgdf_production`
- Client ID : `Comptaweb`
- `redirect_uri` : `https://sgdf.production.sirom.net/`
- `response_type=code`, `response_mode=fragment`, `code_challenge_method=S256`

Après échange du code, l'utilisateur est redirigé vers Comptaweb qui pose un cookie de session **httpOnly** (donc invisible côté JS page) valable pour les appels suivants.

**Approche auth du client TS** : à arbitrer (flow programmatique OIDC via `openid-client`, ou cookie copié manuellement depuis une session navigateur, ou ROPC si autorisé par le realm). À trancher avant implémentation.

---

## Endpoints en lecture

### `GET /rapprochementbancaire?m=1`

Page **rapprochement bancaire**. Le paramètre `m=1` semble être un identifiant de menu (pas de compte bancaire).

**Contenu de la page** :
- Un select `comptebancaire` listant les comptes bancaires du groupe (souvent 1 seule option).
- **Deux tables imbriquées** dans `form#form_rapprochement` :
  - **Table 1 — écritures comptables non rapprochées** : écritures déjà saisies côté compta, pas encore rapprochées. Colonnes : checkbox, Date écriture, Type de transaction, Intitulé, Devise, Montant, N° de pièce, Mode de transaction, Tiers. Checkbox `name="ecriture_a_rapprocher[<ID_ECRITURE>]"`.
  - **Table 2 — écritures bancaires non rapprochées** : lignes qui remontent du compte bancaire (non encore rattachées à une écriture). Colonnes : checkbox, Date opération, Montant, Intitulé. Checkbox `name="releve_a_rapprocher[<ID_LIGNE_BANCAIRE>]"`.
- **Sous-lignes DSP2 enrichies** : certaines lignes bancaires (typiquement les paiements carte "PAIEMENT C. PROC …" qui agrègent plusieurs transactions) contiennent un bouton `+` qui **déplie un sous-tableau déjà présent dans le HTML** (via `plierdeplier(<ID>)` — pas d'appel réseau) avec une ligne par transaction commerciale : `(Montant, Commerçant)`. La somme des sous-montants correspond au montant agrégé. **Précieux pour le workflow d'enrichissement** (une ligne bancaire → N factures → N écritures).

**Selecteurs DOM utiles pour parser** :
- Ligne bancaire principale : `tr[id^="ligne_releve["]` — l'attribut `id` contient l'ID de la ligne bancaire.
- Détails dépliables : `tbody[id^="details_"]` (ex. `#details_19024102`), contenant `tr` avec 2 cells `(montant, commerçant)`.
- Hidden inputs listant toutes les lignes bancaires proposées : `input[name^="eb_a_rapprocher["]`.

### `GET /recettedepense?m=1`

Page **liste des écritures de gestion courante** (dépenses + recettes saisies).

- Table `table#DataTables_Table_0` avec colonnes : Date, Compte bancaire, Intitulé, Dépense, Recette, N° pièce, Mode de transaction, Catégorie tiers, Structure du tiers.
- Pas de pagination serveur observée — toutes les écritures du mois (ou de la période active) sont dans le HTML.
- Filtres additionnels (multi-select `filtre_activite`, `filtre_branche`) servent à un **export** via POST `/recettedepense` (à ne pas confondre avec la saisie d'écriture).

### `GET /recettedepense/creer`

Formulaire de **création d'une écriture** (dépense ou recette). Les référentiels sont **embarqués dans les selects** de cette page : pas d'endpoint séparé à appeler pour les récupérer.

Champs et référentiels embarqués :

| Champ | Type | Remarque |
|---|---|---|
| `ecriturecomptable[depenserecette]` | select (3 options) | Dépense / Recette / Transfert interne |
| `ecriturecomptable[libel]` | text | intitulé |
| `ecriturecomptable[dateecriture]` | text (date FR) | |
| `ecriturecomptable[devise]` | select (~8 options) | EUR par défaut |
| `ecriturecomptable[montant]` / `[montantEUR]` | text / hidden | |
| `ecriturecomptable[numeropiece]` | text | |
| `ecriturecomptable[modetransaction]` | select | mode de paiement |
| `ecriturecomptable[comptebancaire]` | select | compte bancaire |
| `ecriturecomptable[chequier]` / `[chequenum]` / `[cartebancaire]` / `[carteprocurement]` / `[caisse]` | select | champs conditionnels selon mode |
| `ecriturecomptable[tierscateg]` / `[tiersstructure]` | select | tiers |
| `ecriturecomptable[montant_ancv]` | text | montant ANCV (chèques vacances) |

**Ventilations** (répétables par index 0, 1, 2, …) :

| Champ | Type | Remarque |
|---|---|---|
| `ecriturecomptable[ecriturecomptabledetails][N][nature]` | select (~51 options) | catégorie comptable SGDF |
| `ecriturecomptable[ecriturecomptabledetails][N][activite]` | select | activité |
| `ecriturecomptable[ecriturecomptabledetails][N][brancheprojet]` | select | unité |
| `ecriturecomptable[ecriturecomptabledetails][N][montant]` / `[montantEUR]` | text / hidden | |

---

## Endpoints en écriture

### `POST /rapprochementbancaire/update/<ID_COMPTE>`

Soumission du formulaire de rapprochement d'une écriture comptable avec une (ou plusieurs) ligne(s) bancaire(s).

Champs observés :
- `comptebancaire=<ID_COMPTE>` (hidden)
- `choix` (radio) — valeur à identifier (probable : type d'action, ex. rapprocher / dé-rapprocher / ignorer)
- `ecriture_a_rapprocher[<ID_ECRITURE>]` (checkbox) — IDs des écritures comptables cochées
- `releve_a_rapprocher[<ID_LIGNE_BANCAIRE>]` (checkbox) — IDs des lignes bancaires cochées
- `ec_a_rapprocher[<ID_ECRITURE>]` (hidden) — liste complète des écritures présentées
- `eb_a_rapprocher[<ID_LIGNE_BANCAIRE>]` (hidden) — liste complète des lignes bancaires présentées

### `POST /recettedepense/nouveau`

Création d'une écriture (dépense ou recette).

- Encodage : `application/x-www-form-urlencoded`.
- Body : l'ensemble des champs `ecriturecomptable[...]` listés ci-dessus, y compris les ventilations indexées.

---

## Inconnues à lever

- **Upload de justificatif** : pas vu sur le formulaire de création (encodage `urlencoded`, pas `multipart`). Écran séparé à cartographier (probable : édition d'une écriture existante ou rattachement via une page dédiée).
- **Mécanisme précis du champ `choix`** dans le rapprochement (3 valeurs radio observées, sémantique à confirmer).
- **Rate limiting éventuel** côté Comptaweb : non testé.
- **Comportement en cas d'expiration de session** : à tester (redirection 302 vers Keycloak probablement).
- **Endpoint d'édition d'une écriture existante** : non cartographié (et **volontairement exclu** du scope ADR-011 — modification = UI).
- **Endpoint de ré-authentification silencieuse** (refresh token) : à vérifier lors de l'impl.

---

## Notes de sécurité

- Le cookie de session est **httpOnly** (bon). Il doit vivre uniquement dans le process Node (jamais dans le repo, jamais dans un log).
- Aucun token CSRF observé → côté attaque web, l'app est vulnérable CSRF ; côté client Node, ça nous simplifie la vie (pas de scraping de token avant chaque POST).
- Les payloads bruts observés pendant la discovery contiennent des données nominatives et financières réelles : **jamais** committer un payload brut dans ce dépôt. Les exemples donnés ici sont anonymisés.
