# Plan d'exécution P2 — pivot webapp

Plan détaillé du chantier "phase 2" tel qu'acté par la roadmap : la webapp `web/` devient la source de vérité opérationnelle (BDD + API + règles métier + auth multi-user), le MCP `baloo-compta` est refondu en client HTTP de cette API. Cf. [`roadmap.md`](roadmap.md), [`architecture.md`](architecture.md), [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git).

Ce document est un **plan d'exécution**, pas un ADR. Les décisions structurelles prises pendant son exécution donneront lieu à des ADRs séparés (ex. choix de la lib d'auth, choix de l'hébergement).

---

## 1. État actuel (constat technique)

À date (2026-04-25), `web/` et `compta/` accèdent **tous les deux directement** à la même SQLite (`data/baloo.db`) via `better-sqlite3` :

- `compta/src/tools/*.ts` (19 modules, ~60 outils MCP au total) : la logique métier exposée comme outils MCP. SQL en dur dans chaque tool via `getDb().prepare(...)`, pas de couche service.
- `web/src/lib/queries/*.ts` et `web/src/lib/actions/*.ts` : **réimplémentation partielle** de la même logique, consommée par les pages Next.js (server components + server actions).
- Conséquence : duplication sur `overview`, `ecritures`, `remboursements`, `caisse`, `justificatifs` au minimum.
- Pas d'auth : `web/` résout le user courant via `BALOO_USER_EMAIL` (env var, qu'elle lit en triche depuis `compta/.env` via `web/src/lib/comptaweb/env-loader`). `compta/` n'a pas de notion de user courant — le MCP travaille comme un seul user implicite.
- **Le client Comptaweb est déjà dupliqué** : `compta/src/comptaweb-client/` *et* `web/src/lib/comptaweb/` sont des copies quasi-identiques. Le commentaire TODO dans `web/src/lib/comptaweb/env-loader.ts` mentionne l'intention de mutualiser.
- Pas de pnpm workspace racine : `compta/` et `web/` sont deux projets TS indépendants avec leur `package.json` séparé. Le seul lien physique = la BDD partagée et le `.env` partagé.

C'est exactement la situation que le pivot doit corriger : il faut **une seule** couche métier, dans `web/`, exposée via une API HTTP, avec une vraie auth.

## 2. Architecture cible (rappel)

```
Trésorier (Claude Code)          Chefs / parents (navigateur)
        │                                  │
        ▼                                  ▼
┌──────────────────────┐         ┌──────────────────────┐
│ MCP baloo-compta     │         │  Webapp Next.js      │
│ (client HTTP, token) │         │  (UI scopée par rôle)│
└──────────┬───────────┘         └──────────┬───────────┘
           │                                │
           └──────────────┬─────────────────┘
                          ▼
              ┌────────────────────────┐
              │  API HTTP de la webapp │
              │  (route handlers,      │
              │   règles métier,       │
              │   auth, scopes)        │
              └────────────┬───────────┘
                           ▼
                  ┌────────────────┐
                  │  BDD (Postgres │
                  │  ou SQLite     │
                  │  hébergée)     │
                  └────────────────┘
```

## 3. Plan d'exécution séquencé

Le pivot est découpé en **6 chantiers** qui peuvent en partie se chevaucher mais ont des dépendances logiques. Chaque chantier doit être livrable et arrêtable indépendamment.

### Chantier 1 — Consolidation de la couche métier dans `web/`

**Objectif** : éliminer la duplication `compta/src/tools/` ↔ `web/src/lib/queries|actions/` en faisant de `web/` la **seule** source de logique métier, sans encore exposer d'API ni casser le MCP.

**Travaux** :
- Créer `web/src/lib/services/` qui devient la couche service unique (logique métier pure, indépendante du transport HTTP/MCP).
- Migrer le code de `compta/src/tools/*.ts` qui n'est pas déjà dans `web/src/lib/queries+actions/` vers `web/src/lib/services/`. Privilégier l'unification de signatures.
- À ce stade, le MCP **continue** de taper la BDD directement (statu quo) — on ne casse rien.
- Marquer comme deprecated les fonctions encore dupliquées dans `compta/src/tools/` (commentaire `// DEPRECATED: à remplacer par appel HTTP en chantier 3`).

**Critère** : pour chaque opération métier, il existe **une seule** implémentation canonique dans `web/src/lib/services/`. Les pages `web/` la consomment directement. Le MCP s'en moque encore.

**Livraison incrémentale possible** : par sous-domaine (ecritures, puis remboursements, puis caisse, etc.). Pas besoin de tout faire d'un coup.

### Chantier 2 — Exposition de l'API HTTP

**Objectif** : exposer `web/src/lib/services/` via des route handlers Next.js, avec un format de réponse stable.

**Travaux** :
- Choisir une **convention** de design d'API (à arbitrer dans un mini-ADR ou en début de chantier) :
  - Option A : REST resourceful (`GET /api/remboursements`, `POST /api/remboursements`, `GET /api/remboursements/:id`).
  - Option B : RPC-style (`POST /api/rpc/list_remboursements`, `POST /api/rpc/create_remboursement`) — plus proche du modèle MCP, moins idiomatique côté web.
  - Option C : mix — REST pour les ressources standard, RPC pour les opérations transverses (`vue_ensemble`, `recherche`).
- Créer les route handlers sous `web/src/app/api/` qui appellent les services.
- Définir un format de **réponse** standard (snake_case côté API, montants en cents avec format français aussi, codes erreur typés).
- Pas encore d'auth à ce stade — l'API tourne en local et `BALOO_USER_EMAIL` reste la source de contexte.
- Tests d'intégration minimaux par endpoint (peut être fait via un script Node curl-like, ou Playwright API).

**Critère** : chaque opération métier MCP existante a un endpoint HTTP équivalent. On peut reproduire `vue_ensemble`, `create_remboursement`, etc. via `curl` depuis le terminal.

**Hors scope du chantier** : auth, déploiement, refonte MCP. C'est juste l'API.

### Chantier 3 — Refonte du MCP `baloo-compta` en client HTTP

**Objectif** : le MCP n'attaque plus la BDD ; il appelle `web/`.

**Travaux** :
- Réécrire chaque module de `compta/src/tools/*.ts` pour qu'il appelle l'endpoint HTTP correspondant au lieu de `getDb().prepare(...)`.
- Retirer la dépendance `better-sqlite3` de `compta/package.json`.
- Conserver **stables** les noms et signatures des outils MCP exposés à Claude Code (`vue_ensemble`, `create_ecriture`, etc.) — l'utilisateur ne doit voir aucun changement de surface.
- Configuration : ajouter `BALOO_API_URL` (ex. `http://localhost:3000` en dev, URL de prod ensuite) et `BALOO_API_TOKEN` (placeholder pour le chantier 4) dans `compta/.env`.
- Le client HTTP utilise `fetch` natif (Node 22+) — pas de nouvelle dépendance.

**Critère** : on peut supprimer `data/baloo.db` (en dev) et le MCP continue de fonctionner tant que `web/` tourne.

**Migration douce** : on peut maintenir les **deux** modes (DB direct + HTTP) pendant une journée de bascule via un flag, mais pas plus — on évite les feature flags persistants.

### Chantier 4 — Auth multi-user

**Objectif** : remplacer `BALOO_USER_EMAIL` par une vraie auth, et propager la notion de user courant côté API et UI.

**Travaux** :
- **Choix de la lib d'auth** (à arbitrer en début de chantier, ADR à créer) :
  - Auth.js / NextAuth v5 — le plus standard côté Next.js.
  - Better Auth — alternative récente, plus contrôlable.
  - Lucia (déprécié, pas retenir).
  - OIDC SGDF — si la fédération expose un IdP, ce serait le rêve. Vérifier la dispo et la procédure d'inscription d'application.
  - Magic link maison — minimaliste, mais on réinvente la roue.
- **Mécanisme côté UI** : login simple (email + magic link, ou OIDC SGDF). Pas de mot de passe maison.
- **Mécanisme côté MCP** : token long-vie (PAT-like) stocké dans `compta/.env` ou dans `user_credentials` (BDD). Le MCP s'authentifie comme un user "trésorier" — c'est le user courant de l'opérateur Claude Code.
- Adapter les services et l'API : tous les appels prennent un `userId`/`groupId` issu de la session, plus de fallback env var.
- Middleware d'auth sur tous les `/api/*` (sauf l'endpoint de login lui-même).
- Migrer `web/src/lib/context.ts` pour qu'il lise la session au lieu de l'env var.

**Critère** : la webapp refuse l'accès non authentifié ; le MCP s'authentifie via token et exécute toutes ses opérations en tant que ce user.

**Hors scope** : rôles/scopes (chantier 5).

### Chantier 5 — Rôles applicatifs et vues scopées

**Objectif** : ouvrir l'outil à `chef_unite` et `parent` (cf. [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git) pour le modèle).

**Travaux** :
- Activer les filtres de scope dans la couche service : `chef_unite` ne voit que les écritures/remboursements de son `scope_unite_id` ; `parent` ne voit que ses propres remboursements/dons (lien via `personnes.user_id`).
- Filtres en **deux endroits** : (a) dans les services (sécurité), (b) dans les requêtes UI (UX, ne pas afficher ce qui n'est pas accessible).
- Pages UI dédiées :
  - `/u/[unite]` — vue chef d'unité (budget, écritures, justifs en attente, upload).
  - `/moi` — espace parent/donateur (mes paiements, reçus fiscaux à venir).
- Onboarding minimal : invitation par email d'un user existant (depuis l'admin trésorier), création de compte au premier login.

**Critère** : un chef d'unité connecté ne voit que ce qui est dans son scope, et peut déposer un justif sur une de ses écritures. Un parent ne voit que ses propres remboursements.

### Chantier 6 — Upload justif depuis l'UI + déplacement client Comptaweb

**Objectif** : finaliser le périmètre P2 côté UI et finir de vider `compta/`.

**Travaux** :
- Page d'upload de justif côté UI (chef d'unité). Stockage : commencer en local (`justificatifs/` côté serveur), prévoir abstraction pour S3-compatible plus tard.
- Déplacer `compta/src/comptaweb-client/` vers `web/src/lib/comptaweb/` (intégrer aux routes API existantes, ex. `POST /api/comptaweb/sync`).
- Le MCP appelle ces routes au lieu d'avoir son propre client.
- À l'issue : `compta/` ne contient plus que la couche client HTTP MCP. Si la dette résiduelle est faible, le repo `compta/` peut même fusionner dans `web/` — à arbitrer.

**Critère** : `compta/` est un client HTTP minimaliste (~quelques centaines de lignes), `web/` porte tout le reste.

### Chantier 7 (transverse) — Migration BDD et déploiement

**Objectif** : sortir SQLite du dev local et déployer la webapp.

**Travaux** :
- **Choix BDD prod** (à arbitrer dans un ADR) :
  - SQLite hébergée (LiteFS, Turso) — léger, suffisant pour 1 groupe.
  - Postgres managé (Neon, Supabase, Fly Postgres) — préparation directe pour la P3 multi-tenant.
- Adapter `web/src/lib/db.ts` pour supporter Postgres si retenu (le schéma `compta/src/schema.sql` est déjà SQL-standard, cf. ADR-010 ; la migration est mécanique).
- **Choix hébergement** (à arbitrer dans un ADR) :
  - Vercel + Neon Postgres — zero ops, friction minimale.
  - VPS Hetzner + docker-compose (Next.js + Postgres) — contrôle total, ~5€/mois.
  - Fly.io — entre les deux.
- Domaine, TLS, sauvegarde BDD quotidienne, logs basiques.
- Script de migration des données dev → prod (probablement un dump-restore ponctuel + un seed).

**Critère** : trois URLs accessibles (trésorier, un chef d'unité de test, un parent de test) avec auth fonctionnelle. Backup quotidien vérifié.

## 4. Décisions à prendre pendant l'exécution

Ces décisions ne se tranchent pas dans ce plan ; elles donneront lieu à des ADRs au moment où le chantier les rencontre :

- **Convention API** (REST / RPC / mix) — chantier 2, début.
- **Lib d'auth** (Auth.js, Better Auth, OIDC SGDF) — chantier 4, début.
- **BDD prod** (SQLite hébergée vs Postgres managé) — chantier 7.
- **Hébergement** (Vercel + Neon, VPS Hetzner, Fly.io) — chantier 7.
- **Stockage justifs** (FS local vs S3-compatible) — chantier 6, peut être repoussé en P3.
- **Chiffrement `user_credentials`** (laissé ouvert dans ADR-013) — pendant le chantier 4 ou juste après.
- **Devenir de `compta/`** : repo séparé ou fusion dans `web/` ? — chantier 6, fin.

## 5. Risques et garde-fous

- **Risque : la duplication s'aggrave avant qu'on consolide.** Garde-fou : le chantier 1 est prioritaire ; aucune nouvelle feature côté `web/` ne contourne `web/src/lib/services/` une fois cette couche établie.
- **Risque : casser l'usage trésorier pendant le chantier 3.** Garde-fou : le MCP HTTP est testé en parallèle du MCP DB-direct avant bascule. Bascule en une fois (pas de feature flag long).
- **Risque : auth bricolée sans ADR.** Garde-fou : un ADR est obligatoire avant toute ligne de code en chantier 4.
- **Risque : déploiement avant consolidation/auth.** Garde-fou : le chantier 7 dépend du chantier 4. Pas d'URL publique tant qu'il n'y a pas d'auth.
- **Risque : sur-ingénierie multi-tenant pendant le pivot mono-groupe.** Garde-fou : les services prennent un `groupId` et le filtrent (le schéma le supporte déjà), mais aucune UI/UX d'admin multi-groupe n'est ajoutée — c'est P3.
- **Risque : RGPD léger pendant la P2.** Garde-fou : avant le **premier login externe** (chef ou parent), revoir [`security-rgpd.md`](security-rgpd.md) et appliquer les "règles supplémentaires P2" (auth réelle, hébergement EU, logs, info users).

## 6. Critère de succès global P2

Repris de la roadmap : sur 1 mois, ≥2 chefs d'unité utilisent activement la webapp pour leurs justifs et ≥1 parent consulte son espace, sans relance. Le trésorier continue d'utiliser Claude Code via le nouveau MCP sans perte fonctionnelle.

Ce critère ne peut être validé qu'à la fin du chantier 6 + 7. Mais chaque chantier individuel a son propre critère intermédiaire (cf. ci-dessus).

## 7. Ce que ce plan ne couvre pas

- L'**ouverture multi-groupes** (P3).
- L'**agent LLM côté serveur** dans la webapp (cap lointain, hors phase numérotée).
- La **monétisation** (P4).
- L'**Agent SDK** (Claude Code reste le runtime trésorier ; pas d'agent serveur en P2).
