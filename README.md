<div align="center">

# 🐻 Baloo

**Le carnet du trésorier d'un groupe Scouts et Guides de France.**

Une webapp + un serveur MCP qui aident à tenir la compta opérationnelle d'un groupe SGDF : remboursements, abandons de frais, justificatifs, caisse, dépôts de chèques, budgets par unité. Sync avec Compta-Web (l'outil officiel SGDF), mais centrée sur le quotidien du bénévole.

[![CI](https://github.com/benomite/baloo/actions/workflows/ci.yml/badge.svg)](https://github.com/benomite/baloo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Stack](https://img.shields.io/badge/stack-Next.js%2016%20·%20TypeScript%20·%20Turso-1a3a6c)](#stack)
[![Status](https://img.shields.io/badge/status-en%20prod%20chez%20l'auteur-success)](doc/roadmap.md)

[Site](https://baloo.benomite.com) · [Vision](doc/vision.md) · [Roadmap](doc/roadmap.md) · [ADRs](doc/decisions.md)

</div>

---

## Pourquoi Baloo

Tenir la compta d'un groupe SGDF, c'est jongler entre Compta-Web (l'outil officiel), un tableur pour les unités, Airtable pour les remboursements, Gmail pour les justificatifs, et la mémoire du trésorier pour le reste. **Baloo réunit l'opérationnel dans un seul endroit**, sans remplacer Compta-Web qui reste la source de vérité comptable.

Le projet est mené par un trésorier en exercice. Il est utilisé en production sur le groupe Val de Saône depuis 2026.

## Pour qui

- **Trésorier·ère SGDF** : tu veux automatiser ce qui peut l'être (rapprochement DSP2, relances justificatifs, états mensuels).
- **Chef·fe d'unité** : tu veux suivre ton budget d'unité et déposer des justifs depuis ton mobile sans email.
- **Parent / donateur** : tu veux voir tes paiements et récupérer ton reçu fiscal.
- **Curieux MCP / Claude Code** : un cas réel d'app full-stack avec serveur MCP en client HTTP de la webapp.

## Fonctionnalités

- **Écritures** — saisie, import CSV Comptaweb, rapprochement bancaire DSP2.
- **Workflows internes** — dépôt de justificatif, remboursement, abandon de frais (avec CERFA), caisse espèces. Signature électronique, génération PDF, notifs email.
- **Budgets par unité** — vue, prévisionnel, répartitions inter-unités (Farfadets, LJ, SG, Pi, Co, Groupe).
- **Multi-rôles** — trésorier·ère, RG, chef·fe (scopé à son unité), équipier·ère, parent.
- **PWA mobile + desktop** — installable Chrome / iOS, design system « carnet du trésorier ».
- **Serveur MCP** — interface ligne de commande via [Claude Code](https://claude.com/claude-code) pour le trésorier (`vue_ensemble`, `create_ecriture`, `cw_list_rapprochement_bancaire`…).
- **Client Comptaweb** — lecture des écritures et lignes bancaires non rapprochées (avec sous-lignes DSP2 enrichies).

## Stack

- **Webapp** : Next.js 16 (App Router, Server Actions, Cache Components), TypeScript, Tailwind, base-ui.
- **Base de données** : Turso (libSQL) en prod, SQLite en local. Schéma SQL standard, multi-tenant prêt.
- **Auth** : NextAuth v5, magic link email (Resend).
- **Stockage fichiers** : Vercel Blob (privé, signed URLs).
- **Hébergement** : Vercel.
- **MCP** : [Model Context Protocol](https://modelcontextprotocol.io/) via stdio, client HTTP de la webapp.

## Quick start

Prérequis : **Node 20+**, **pnpm 10**.

```bash
git clone https://github.com/benomite/baloo.git
cd baloo

# 1. Webapp
cd web
pnpm install
cp .env.example .env.local       # remplir AUTH_SECRET, TURSO_*, RESEND_API_KEY...
pnpm bootstrap                    # crée la BDD + groupe démo
pnpm dev                          # http://localhost:3000

# 2. Serveur MCP (optionnel, pour Claude Code)
cd ../compta
cp .env.example .env
$EDITOR .env                      # remplir BALOO_API_URL + BALOO_API_TOKEN
npm install && npm start
```

Pour utiliser Baloo depuis Claude Code, assurez-vous que `.mcp.json` référence bien le serveur `compta`. Génération du token API : `cd web && pnpm exec tsx scripts/generate-api-token.ts <email>`.

## Structure du projet

```
baloo/
├── web/                # Webapp Next.js (source de vérité)
│   ├── src/app/        # Routes App Router (auth /(app), publique racine)
│   ├── src/lib/        # Services métier, auth, BDD
│   └── scripts/        # Bootstrap, imports, migrations
├── compta/             # Serveur MCP TypeScript (client HTTP de l'API webapp)
├── doc/                # Vision, architecture, ADRs, roadmap, specs
├── sgdf-core/          # Connaissances génériques SGDF (glossaire, process)
├── skills/             # Process métier (format « skill » Claude Code)
├── CLAUDE.md           # Prompt système pour l'assistant
└── .mcp.json           # Configuration des serveurs MCP
```

**Aucune donnée de groupe** n'est versionnée. Les données spécifiques (noms, comptes, montants) vivent en BDD (`data/baloo.db` gitignored) et `.env` (gitignored). Cf. [ADR-013](doc/decisions.md).

## Documentation

| Document | Sujet |
|---|---|
| [`doc/vision.md`](doc/vision.md) | À quoi sert Baloo, pour qui, pourquoi |
| [`doc/architecture.md`](doc/architecture.md) | Choix techniques |
| [`doc/roadmap.md`](doc/roadmap.md) | Phases, du MVP perso au SaaS potentiel |
| [`doc/decisions.md`](doc/decisions.md) | Journal des décisions d'architecture (ADRs) |
| [`doc/comptaweb-api.md`](doc/comptaweb-api.md) | Client Comptaweb (scope, discovery) |
| [`doc/integrations.md`](doc/integrations.md) | Configuration des MCPs externes |
| [`doc/security-rgpd.md`](doc/security-rgpd.md) | Bonnes pratiques données sensibles |
| [`doc/memory-design.md`](doc/memory-design.md) | Mémoire long terme |
| [`CHANGELOG.md`](CHANGELOG.md) | Historique des évolutions |

## Statut et limites

- **En prod** chez l'auteur (groupe SGDF Val de Saône) depuis 2026, dans un usage quotidien.
- **Mono-groupe** au stade actuel. Le schéma est multi-tenant ; l'activation multi-groupes est en phase 3 (cf. roadmap).
- **Pas de tests E2E** automatisés. Tests unitaires Vitest sur les services critiques (transitions de workflow, import CSV, etc.).
- **Client Comptaweb** : auth Keycloak automatisée (cookie persisté), pas d'API officielle SGDF.

## Pre-commit hook de protection

Un hook bloque les commits qui contiennent des données sensibles :

```bash
git config core.hooksPath scripts/git-hooks
cp scripts/git-hooks/secrets-patterns.example scripts/git-hooks/secrets-patterns.local
$EDITOR scripts/git-hooks/secrets-patterns.local
```

## Contribuer

Le projet accueille les retours d'usage, les issues, et les PRs **après discussion**. La feuille de route est resserrée (cf. [`doc/roadmap.md`](doc/roadmap.md)) — ouvre une issue avant d'investir du temps sur une PR de fonctionnalité.

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — comment proposer un changement, conventions de commit, setup dev.
- [`SECURITY.md`](SECURITY.md) — comment signaler une faille (le projet manipule des données financières et de mineurs).
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — règles de civilité.
- [`doc/DEVELOPING.md`](doc/DEVELOPING.md) — règles internes de modification du projet.

## Licence

MIT — voir [`LICENSE`](LICENSE).

---

<sub>Baloo n'est pas un projet officiel des Scouts et Guides de France. C'est un outil indépendant développé par un bénévole pour les bénévoles.</sub>
