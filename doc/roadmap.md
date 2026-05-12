# Roadmap

Le projet est pensé en **4 phases** progressives. Chaque phase est validée avant d'investir dans la suivante. Le principe directeur : **ne pas construire pour un besoin non validé**.

> **Note de cap** (2026-04-25) : la roadmap a été révisée pour acter un pivot d'archi. La cible n'est pas "CLI + MCP en MVP, webapp en P3" comme initialement écrit, mais **webapp = source de vérité** dès la P2. Le MCP `baloo-compta` devient un client HTTP de la webapp pour exposer ses opérations à Claude Code (LLM local). L'historique de la P1 (CLI + MCP + SQLite local) reste valide comme MVP de validation, mais sa BDD est provisoire.

---

## Phase 1 — MVP perso CLI (en voie d'achèvement)

**Objectif** : l'auteur utilise Baloo tous les jours pour tenir la compta et l'orga du groupe, **dans Claude Code**, et ce mode CLI sert à valider concrètement les besoins métier avant la bascule webapp de la P2.

**Stack** : Claude Code + markdown (doc, skills) + MCPs + SQLite local (via le MCP `baloo-compta`). Coût marginal 0€.

**Livrables — état au 2026-04-25** :
- ✅ `CLAUDE.md` à la racine (rôle, conventions, sources de vérité).
- ✅ Mémoire opérationnelle structurée **en BDD SQLite** via le MCP `baloo-compta` (personnes, comptes, budgets, écritures, remboursements, notes, todos). Cf. [ADR-010](decisions.md#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript) et [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git). `mon-groupe/` retiré du repo.
- ✅ Vue compta opérationnelle via la commande MCP `vue_ensemble` (trésorerie, remboursements en attente, alertes). Remplace l'ancien `mon-groupe/finances.md`.
- ✅ `sgdf-core/` amorcé (glossaire, ressources chefs/cadres, premier skill `remboursement`).
- ✅ MCP **Gmail/Workspace** configuré en lecture seule (`workspace-mcp --read-only --tools gmail drive sheets`).
- ✅ **Client Comptaweb** (initialement prévu en P2) : auth Keycloak avec session persistée + lecture des écritures et **lignes bancaires non rapprochées avec sous-lignes DSP2** (cf. [ADR-011](decisions.md#adr-011--client-api-comptaweb-par-reverse-engineering), [ADR-012](decisions.md#adr-012--comptaweb--webapp-server-rendered-scraping-html-avec-cheerio), [`comptaweb-api.md`](comptaweb-api.md)).
- ✅ Schéma BDD **multi-user / multi-tenant** prêt (rôles, scopes, `groupes`, `users`, `personnes`, `user_credentials`), non activé au MVP — cf. [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git).
- ✅ Versionné en git (repo local).
- ⏳ **2ème skill** (`adhesion` ou équivalent) — manque. Le format de skill est validé par `remboursement` ; il faut en sortir un autre pour confirmer la convention.
- ⏳ **MCP Notion** — non configuré. Acté "à faire si besoin émerge", non bloquant pour clore la P1. Notion reste utilisable côté humain via le navigateur.

**Important** : la BDD SQLite locale du MCP est **provisoire**. Elle migrera vers la BDD de la webapp en P2 (cf. note de statut sur [ADR-010](decisions.md#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript)). Le schéma étant SQL-standard et déjà multi-tenant, la migration est mécanique.

**Critère de succès** : au bout de 3 mois, l'auteur ouvre Claude Code dans `baloo/` au moins 3 fois par semaine pour des tâches réelles, pas pour tester.

**Risques principaux** :
- Formaliser la mémoire prend plus de temps que prévu → OK, c'est l'investissement principal du projet.
- Les MCPs ne couvrent pas certains outils clés → on documente les manques, on ajoute des tools custom uniquement si bloquant.

---

## Phase 2 — Ouverture intra-groupe via webapp (mois 3 → 6 ?)

**Objectif** : la webapp `web/` (Next.js) devient la **source de vérité opérationnelle du groupe**. Elle ouvre des accès aux autres rôles internes : chefs/cheftaines et trésoriers d'unité (consulter le budget de leur unité, déposer des justificatifs), parents et donateurs (consulter leurs propres remboursements, voir leur reçu fiscal). Le multi-groupes reste explicitement repoussé en P3.

Le pivot conceptuel : la webapp porte la BDD, l'API et les règles métier. Le MCP `baloo-compta` est refondu en **client HTTP authentifié de cette API** pour continuer de servir le trésorier dans Claude Code, sans accès BDD direct.

**Livrables** :
- **Webapp Next.js déployée** (la `web/` existante, déjà amorcée) avec une **API HTTP** documentée portant les opérations métier.
- **Migration BDD** : SQLite locale → BDD côté webapp (Postgres managé ou Postgres léger sur VPS — à arbitrer à l'impl). Le schéma [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git) étant SQL-standard et multi-tenant, la migration est mécanique.
- **Refonte du MCP `baloo-compta`** : il devient un client HTTP de l'API webapp. Plus de `better-sqlite3`, plus de SQL en dur. Les commandes MCP exposées à Claude Code (`vue_ensemble`, `create_ecriture`, `list_remboursements`, etc.) restent stables côté usage ; leur impl tape l'API.
- **Auth multi-user activée** sur la webapp (mécanisme à arbitrer à l'impl : magic link, OIDC SGDF si disponible, etc.). Le MCP s'authentifie comme un user "trésorier" via un token.
- **Rôles applicatifs effectifs** (cf. [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git), révisés en [ADR-019](decisions.md#adr-019--hiérarchie-de-rôles-applicatifs-v2)) : `tresorier`, `RG`, `chef` (filtré à son unité), `equipier` (dépôts + demandes), `parent` (lecture de ses propres paiements et reçu fiscal).
- **Vues UI scopées par rôle** : budget d'unité pour le chef, espace perso pour le parent, vue d'ensemble pour le trésorier.
- **Upload de justificatifs** depuis la webapp (chef d'unité), stockage fichier hors BDD, référencé via chemin/URL.
- **Client Comptaweb intégré côté webapp** : déplacé de `compta/src/comptaweb-client/` vers le backend de la webapp, exposé via l'API. Garde les acquis P1 (auth Keycloak, lecture rapprochement bancaire DSP2).
- **Saisie assistée Compta-Web** : checklists et données pré-formatées prêtes à recopier, voire automation navigateur (Claude in Chrome) sur quelques opérations simples. Pas de saisie autonome, juste assistance. Cf. [ADR-007](decisions.md#adr-007--outil-compta-unifié--compta-web-reste-maître-baloo-devient-lamont).
- Décision go/no-go pour la phase 3.

**Plans d'exécution P2** :
- [`p2-pivot-webapp.md`](p2-pivot-webapp.md) — pivot archi (webapp = source de vérité, MCP en client HTTP). 7 chantiers livrés, app en prod sur baloo.benomite.com.
- [`p2-workflows-internes.md`](p2-workflows-internes.md) — 4 workflows internes self-service (dépôt justif, remb, abandon, caisse) qui complètent la P2 jusqu'au critère de succès "≥2 chefs actifs + ≥1 parent". **Tous les chantiers livrés** (2026-05-04). Refonte UX, gestion membres, comptable enrichi, visibilité prod, tests étendus. Cf. ADR-024 à ADR-027.
- [`p2-budgets-par-unite.md`](p2-budgets-par-unite.md) — pilotage budgétaire par unité (Farfadets / LJ / SG / PC / CO / Groupe). 3 phases livrées (2026-05-10 → 2026-05-11) : vue par unité (PR #9), budgets prévisionnels (PR #10), répartitions entre unités (PR #11). 43 commits, 2 ADRs structurels (cf. ADR-029, ADR-030).

**Statut au 2026-05-11** : **P2 techniquement bouclée** ✅, enrichie du pilotage par unité. L'app supporte le scope cible (5 rôles, 4 workflows, signatures électroniques, génération PDF, notifs email, mobile + PWA, page d'aide, journal d'erreurs interne, export CSV, rapprochement bancaire DSP2 visible, **vue + budget + répartitions par unité**, etc.). Reste l'**activation terrain** (≥2 chefs actifs + 1 parent) qui n'est pas un chantier dev — il faut inviter les vrais users et observer ce qui coince. Le pilotage par unité sera réellement éprouvé sur les inscriptions Val de Saône de septembre 2026.

**Stack** : Next.js (déjà en place dans `web/`) + API + Postgres (ou équivalent) + déploiement (VPS/Vercel/Fly.io). MCP `baloo-compta` réécrit comme client HTTP TypeScript.

**Coût** : non nul — ~5-15€/mois d'infra. **Rupture explicite vs P1**. Toujours pas d'API LLM payante (Claude Code reste l'unique entrée LLM).

**Critère de succès** : sur 1 mois, ≥2 chefs d'unité utilisent activement la webapp pour leurs justifs et ≥1 parent consulte son espace, sans être relancés ; le trésorier continue d'utiliser Claude Code via le nouveau MCP sans perte fonctionnelle.

**Décision clé de fin de phase** : élargir à d'autres groupes SGDF (P3), ou rester en outil interne au groupe Val de Saône ? Si non, on s'arrête ici, c'est déjà une victoire.

---

## Phase 3 — Multi-groupes hébergé (mois 6 → 12, si phase 2 concluante)

**Objectif** : passer la webapp P2 du mode "un seul groupe" au mode "N groupes isolés", sans la reconstruire.

**Livrables** :
- **Activation effective du multi-tenant** côté webapp (le schéma est prêt depuis [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git), il s'agit d'activer les filtres `group_id` partout dans l'API et l'UI).
- **Onboarding** de nouveaux groupes (wizard de création de groupe, import de la structure d'unités, peuplement initial).
- **Credentials externes par user** : table `user_credentials(user_id, service='comptaweb', username_enc, password_enc, cookie_enc)` + UI `/settings/comptaweb` + chiffrement au repos (clé dans env Vercel ou KMS). Aujourd'hui les credentials Comptaweb vivent en env vars partagés (mono-trésorier) — bloquant pour ouvrir à 5+ groupes. Cf. [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git) (placeholder déjà posé) ; ADR dédié au moment de l'impl pour le chiffrement.
- **Mutualisation infra** : un seul déploiement, plusieurs groupes.
- **Migration éventuelle** vers un Postgres plus robuste si volumes/concurrence le justifient.
- **Recherche sémantique** (pgvector ou équivalent) **uniquement** si le besoin s'en fait sentir à ce stade — pas par défaut.
- **Agent SDK ou agent serveur** : seulement si le cap "LLM intégré à la webapp" (cf. règles transverses) est priorisé à ce moment.

**Stack** : la même qu'en P2, à laquelle s'ajoutent les briques nécessaires aux N groupes (tenancy, observabilité, sauvegardes).

**Coût** : 20-50€/mois d'infra + coût API Claude proportionnel aux users si un agent serveur est introduit (prompt caching obligatoire pour maîtriser ça).

**Critère de succès** : 5+ groupes actifs, feedback positif, auteur pas seul à maintenir.

**Piège à éviter** : reconstruire l'UI ou l'auth alors qu'elles existent déjà depuis la P2. P3 = scaler P2, pas refaire P2.

---

## Phase 4 — SaaS (optionnel, si phase 3 décolle)

**Objectif** : soutenabilité financière et juridique.

**Livrables** :
- Modèle de facturation (5-15€/groupe/mois, couvre largement les coûts API).
- CGU, politique de confidentialité.
- Contrat de sous-traitance RGPD (on traite les données d'autres assos).
- DPO identifié (peut rester externe/mutualisé).
- Processus de support minimal.

**Coût** : temps principalement. Si le projet vit en asso loi 1901 dédiée, montage juridique à prévoir.

**Critère de succès** : autofinancé (revenus ≥ coûts), sans sacrifier la qualité pour l'auteur initial.

---

## Règles transverses

- **Chaque phase doit être "arrêtable".** Si on s'arrête après la phase 1, l'auteur a un outil utile en CLI. Si on s'arrête après la phase 2, le groupe entier (chefs, parents) a un outil utile. Si on s'arrête après la phase 3, plusieurs groupes ont un outil utile. Etc.
- **Aucune décision d'archi n'est prise "au cas où".** On décide au plus tard possible.
- **Les données et les process survivent au code.** Tout ce qui est écrit en markdown ou structuré en BDD en phase 1 est réutilisable en phase 2/3, peu importe le langage final.
- **Cap lointain : LLM intégré à la webapp.** À terme, la webapp embarquera un agent LLM côté serveur pour les users qui n'utilisent pas Claude Code (chefs, parents). Ce n'est pas une phase numérotée — c'est une direction qui guide certains choix d'archi dès la P2 (API stable, opérations idempotentes, audit trail). On ne construit pas d'agent serveur tant qu'il n'y a pas un user concret qui l'attend.
