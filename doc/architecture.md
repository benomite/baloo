# Architecture

> **Note 2026-04-25** : ce document reflète maintenant le présent (P1) **et** la cible (P2) telle qu'actée par le pivot "webapp = source de vérité" (cf. [`roadmap.md`](roadmap.md) et la note de statut sur [ADR-010](decisions.md#adr-010--outil-compta--sqlite--serveur-mcp-nodejstypescript)). L'ancienne version "100% markdown + MCPs externes" décrivait un MVP qui n'existe plus.

## Vue d'ensemble — phase 1 (MVP CLI)

Au MVP, l'utilisateur pilote Baloo depuis **Claude Code** dans un terminal. Le runtime d'agent est Claude Code (couvert par l'abo Max). La compta opérationnelle vit dans une **BDD SQLite locale** (`data/baloo.db`, gitignored), exposée à Claude Code via un **serveur MCP custom** écrit en TypeScript (`compta/`). Les intégrations externes passent par d'autres serveurs MCP (Workspace en lecture seule), et le client Comptaweb pour la lecture des écritures bancaires officielles vit dans le même paquet `compta/`.

```
┌─────────────────────────────────────────────────────┐
│              Utilisateur (terminal)                 │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│                Claude Code CLI                      │
│       (runtime d'agent, auth via abo Max)           │
└──┬───────────┬──────────────┬──────────────┬────────┘
   │           │              │              │
   ▼           ▼              ▼              ▼
┌───────┐ ┌─────────────┐ ┌────────────┐ ┌──────────┐
│CLAUDE │ │ MCP         │ │ MCP        │ │ MCP      │
│ .md   │ │ baloo-compta│ │ workspace  │ │ airtable │
│(racine│ │ (compta/)   │ │ (read-only)│ │(historiq)│
└───────┘ └──────┬──────┘ └────────────┘ └──────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
   ┌────────┐    ┌─────────────────┐
   │SQLite  │    │ Client Comptaweb│
   │baloo.db│    │ (auth Keycloak  │
   │(local, │    │  + scraping     │
   │gitign.)│    │  HTML cheerio)  │
   └────────┘    └─────────────────┘
```

La webapp `web/` (Next.js) est **présente dans le repo** mais joue à ce stade un rôle d'expérimentation/préfiguration. Elle ne porte pas encore l'auth ni l'API métier — c'est l'objet de la P2.

## Vue d'ensemble — phase 2 (cible : ouverture intra-groupe)

La **webapp `web/`** devient la source de vérité opérationnelle. Elle porte la BDD, l'API HTTP, les règles métier et l'auth multi-user. Le MCP `baloo-compta` est refondu en **client HTTP authentifié de cette API** : il garde la même surface d'outils côté Claude Code (`vue_ensemble`, `create_ecriture`, etc.), mais leur implémentation tape l'API au lieu d'attaquer la BDD.

```
┌──────────────────────┐  ┌───────────────────────────┐
│  Trésorier (terminal)│  │  Chefs / parents          │
│  + Claude Code       │  │  (navigateur web)         │
└─────────┬────────────┘  └────────────┬──────────────┘
          │                            │
          ▼                            ▼
┌──────────────────────┐  ┌───────────────────────────┐
│ MCP baloo-compta     │  │  Webapp Next.js           │
│ (client HTTP)        │  │  (UI + auth + API)        │
└─────────┬────────────┘  └────────────┬──────────────┘
          │                            │
          └─────────────┬──────────────┘
                        ▼
            ┌────────────────────────┐
            │  API HTTP de la webapp │
            │  (règles métier)       │
            └─────────────┬──────────┘
                          ▼
                  ┌───────────────┐
                  │ Postgres (ou  │
                  │ équivalent)   │
                  │ multi-tenant  │
                  └───────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ Client Comptaweb      │
              │ (déplacé côté webapp) │
              └───────────────────────┘
```

Cap lointain (pas une phase numérotée) : un agent LLM côté serveur dans la webapp pour les users qui n'utilisent pas Claude Code.

## Stack

| Couche | Choix P1 | Choix P2 (cible) |
|---|---|---|
| Runtime d'agent | Claude Code (CLI, abo Max) | Idem côté trésorier ; pas d'agent serveur |
| Source de vérité opérationnelle | MCP `baloo-compta` + SQLite local | **Webapp + API HTTP + Postgres** |
| MCP `baloo-compta` | Serveur stdio TypeScript, attaque SQLite directement | Serveur stdio TypeScript, **client HTTP de la webapp** |
| UI | Aucune (CLI uniquement) | Webapp Next.js (`web/`) |
| Auth | Aucune (mono-user implicite) | Multi-user activé (mécanisme à arbitrer à l'impl) |
| Doc & process | Markdown versionné en git | Idem (inchangé) |
| Skills | Markdown dans `sgdf-core/skills/` | Idem (les skills ne migrent pas) |
| Intégrations externes | MCPs (Workspace lecture seule, Airtable historique) | Idem côté Claude Code ; client Comptaweb déplacé côté webapp backend |
| Secrets | `.env` local (P1) + `user_credentials` en BDD non chiffré (préparé) | Chiffrement par user à arbitrer à l'impl P2 (voir ADR-013) |
| Déploiement | Aucun (tout en local) | VPS / Vercel / Fly.io — rupture de coût ~5-15€/mois |

## Structure de dossiers (présente)

```
baloo/
├── CLAUDE.md              ← "constitution" de l'assistant
├── doc/                   ← conception, décisions, refs (générique, public-ready)
├── sgdf-core/             ← générique SGDF (glossaire, skills partageables)
│   ├── glossaire.md
│   ├── ressources-chefscadres/
│   └── skills/
│       └── remboursement/SKILL.md
├── skills/                ← skills spécifiques (vide au 2026-04-25)
├── compta/                ← MCP baloo-compta (TypeScript)
│   └── src/
│       ├── index.ts            ← serveur MCP stdio
│       ├── schema.sql          ← schéma multi-tenant ADR-013
│       └── comptaweb-client/   ← client Comptaweb (auth Keycloak + cheerio)
├── web/                   ← webapp Next.js (P2, déjà amorcée)
│   └── src/
├── scripts/               ← outils dev (seed, migration, etc.)
├── data/                  ← (gitignored) baloo.db, sessions Comptaweb
├── inbox/                 ← (gitignored) PDFs, captures, exports
└── .gitignore
```

Plus de `mon-groupe/` : retiré du repo par [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git). Toute donnée spécifique à un user ou à un groupe vit en BDD (`data/baloo.db` aujourd'hui, BDD webapp en P2).

## Intégrations externes

| Système | Priorité | Mode | Mécanisme |
|---|---|---|---|
| Compta-Web (SGDF) | P1 ✅ | Lecture (écritures + lignes bancaires DSP2) | Client TypeScript intégré au MCP `baloo-compta`, auth Keycloak, scraping HTML cheerio. Cf. [ADR-011](decisions.md#adr-011--client-api-comptaweb-par-reverse-engineering), [ADR-012](decisions.md#adr-012--comptaweb--webapp-server-rendered-scraping-html-avec-cheerio). |
| Compta-Web (SGDF) | P2 | Écriture (dépense/recette) + saisie assistée | Même client, scope étendu. Dry-run par défaut. |
| Gmail (asso) | P1 ✅ | Lecture (mails, attachements) | MCP communautaire `workspace-mcp` en `--read-only`. |
| Drive (asso) | P1 ✅ | Lecture | Idem. |
| Sheets | P1 ✅ | Lecture | Idem (transitoire, pour les groupes qui utilisent encore les Sheets). |
| Airtable | P1 ✅ | Lecture historique | MCP officiel Airtable, PAT lecture seule. |
| Notion | — | — | Non configuré au MVP (pas bloquant). À traiter si besoin émerge. |
| WhatsApp | — | — | Hors scope (cf. [`security-rgpd.md`](security-rgpd.md)). |

## Pourquoi pas d'Agent SDK pour l'instant

L'Agent SDK est une bibliothèque Python/TS qui permet d'embarquer un agent Claude dans son propre programme. Utile dès qu'on veut **un service qui tourne sans l'utilisateur devant l'écran** (bot, cron, agent serveur dans la webapp).

En P1, Claude Code suffit (pas d'agent serveur, le trésorier est devant l'écran). En P2, on n'introduit pas non plus d'Agent SDK : le pivot "webapp = source de vérité" est mené sans agent serveur ; les chefs/parents utilisent l'UI directement. L'Agent SDK ne deviendra pertinent que si/quand on veut un LLM intégré côté webapp (cap lointain mentionné en règle transverse de la roadmap).

## Ce qui est volontairement exclu de la P1

- Webapp en production (la `web/` existe en local, pas déployée).
- Auth multi-user activée (préparée par [ADR-013](decisions.md#adr-013--multi-user-dès-larchitecture-aucune-donnée-user-dépendante-en-git), pas allumée).
- Hébergement / VPS.
- Vector embeddings, recherche sémantique.
- Framework de mémoire type Mem0 / Letta / LangChain.
- Automatisations autonomes (cron, webhooks).
- Bot Telegram/WhatsApp.

Chacun de ces éléments est repoussé à une phase ultérieure dans la [roadmap](roadmap.md) et ne sera introduit **que si** l'usage réel le justifie.
