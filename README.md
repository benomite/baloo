# Baloo

**Assistant personnel pour trésoriers de groupes Scouts et Guides de France (SGDF).** Baloo aide à tenir la compta opérationnelle, à suivre les échéances et à alléger le travail du trésorier en s'appuyant sur [Claude Code](https://claude.com/claude-code) comme moteur d'agent.

> Statut : **MVP / phase 1**. Utilisé en production par son auteur, en cours de durcissement avant adoption par d'autres groupes. Cf. [`doc/roadmap.md`](doc/roadmap.md).

## Ce que Baloo sait faire

- **Compta opérationnelle locale** (SQLite) : écritures, remboursements, abandons de frais, mouvements de caisse, dépôts de chèques, justificatifs.
- **Client Comptaweb** (reverse engineering de l'API privée SGDF) : lecture des écritures et des lignes bancaires non rapprochées (avec sous-lignes DSP2 enrichies).
- **Mémoire structurée** : groupe, personnes, comptes bancaires, budgets, todos, notes libres — tout en base, multi-user prêt.
- **Intégrations** : Airtable (MCP officiel), Google Workspace Gmail/Drive/Sheets (MCP communautaire, lecture seule).

## Stack

- **Langage** : TypeScript (Node 20+).
- **Base de données** : SQLite (`better-sqlite3`), schéma SQL standard migrable vers Postgres le jour où ce sera utile.
- **Transport** : [Model Context Protocol](https://modelcontextprotocol.io/) via stdio (pour Claude Code local) ; le web/ Next.js est un prototype en cours pour l'interface graphique.
- **Parsing HTML** : `cheerio` pour le client Comptaweb.

## Quick start

Prérequis : **Node 20+**, **npm**, **[direnv](https://direnv.net)** (recommandé pour charger `.env` automatiquement).

```bash
git clone https://github.com/<you>/baloo.git
cd baloo

# 1. Préparer l'env (variables user/groupe + credentials externes)
cp compta/.env.example compta/.env
$EDITOR compta/.env        # remplir BALOO_GROUP_CODE, _NAME, _USER_EMAIL, etc.

# 2. Installer les dépendances du serveur MCP compta
cd compta && npm install

# 3. Initialiser la BDD (crée le groupe courant + user + unités SGDF standards)
npm run bootstrap

# 4. Lancer le serveur MCP (stdio) pour Claude Code
npm start
```

Pour utiliser Baloo depuis Claude Code : assurez-vous que `.mcp.json` référence bien le serveur `compta`. Les autres MCPs (Airtable, Google Workspace) sont optionnels — cf. [`doc/integrations.md`](doc/integrations.md).

## Structure du projet

```
baloo/
├── compta/              # Serveur MCP TypeScript (compta + client Comptaweb)
│   └── src/
│       ├── tools/       # Outils MCP exposés (list_ecritures, create_remboursement...)
│       ├── scripts/     # Scripts one-shot (bootstrap, imports depuis markdown)
│       └── comptaweb-client/   # Client HTTP + parsing HTML de Comptaweb
├── doc/                 # Conception, ADRs, intégrations, roadmap
├── sgdf-core/           # Connaissances génériques SGDF (glossaire, process)
├── skills/              # Process métier (format "skill" Claude Code)
├── web/                 # Prototype d'UI Next.js (en chantier)
├── CLAUDE.md            # Prompt système pour l'assistant
└── .mcp.json            # Configuration des serveurs MCP
```

Les données **spécifiques à un groupe** (noms, comptes, montants) vivent exclusivement en BDD (`data/baloo.db`, gitignored) et dans `.env` (gitignored). Le dépôt ne contient **aucune** donnée nominative — cf. [ADR-013](doc/decisions.md).

## Documentation

- [`doc/vision.md`](doc/vision.md) — à quoi sert Baloo, pour qui, pourquoi.
- [`doc/architecture.md`](doc/architecture.md) — choix techniques.
- [`doc/roadmap.md`](doc/roadmap.md) — phases, du MVP perso au SaaS potentiel.
- [`doc/decisions.md`](doc/decisions.md) — journal des décisions d'architecture (ADRs).
- [`doc/comptaweb-api.md`](doc/comptaweb-api.md) — feature client Comptaweb (scope, discovery).
- [`doc/integrations.md`](doc/integrations.md) — configuration des MCPs externes.
- [`doc/security-rgpd.md`](doc/security-rgpd.md) — bonnes pratiques données sensibles.
- [`doc/memory-design.md`](doc/memory-design.md) — mémoire long terme.

## Statut actuel et limites

- **Mono-user** au MVP. Le schéma SQLite est **multi-tenant prêt** (`group_id` partout, tables `users`, `user_credentials`, `notes`, ...) mais aucune vérification de droit n'est active aujourd'hui. Cf. [ADR-013](doc/decisions.md).
- **Client Comptaweb** : auth par cookie copié manuellement depuis un navigateur. L'automatisation de l'auth (flow Keycloak OIDC) est sur la roadmap.
- **Intégration webapp** : prototype Next.js dans `web/`, pas encore branché sur la BDD.
- **Pas de tests automatisés** au MVP. Les scripts d'import vivent comme validation manuelle.

## Pre-commit hook de protection

Un hook bloque les commits qui contiennent :
- Des fichiers dans `mon-groupe/`, `data/`, `justificatifs/`, `inbox/` (données user/groupe, voir [ADR-013](doc/decisions.md)).
- Des motifs sensibles custom déclarés dans `scripts/git-hooks/secrets-patterns.local` (gitignored).

**Activation après un clone** :

```bash
git config core.hooksPath scripts/git-hooks
cp scripts/git-hooks/secrets-patterns.example scripts/git-hooks/secrets-patterns.local
$EDITOR scripts/git-hooks/secrets-patterns.local   # ajouter tes motifs (noms, emails, IDs)
```

## Contribuer

Le projet est à un stade trop précoce pour une contribution ouverte. Pour l'instant, retours d'usage, questions et suggestions sont bienvenus dans les issues. Le mode de travail et les règles pour faire évoluer Baloo sont décrits dans [`doc/DEVELOPING.md`](doc/DEVELOPING.md).

## Licence

MIT — voir [`LICENSE`](LICENSE).
