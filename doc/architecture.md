# Architecture

## Vue d'ensemble (MVP)

Le MVP repose entièrement sur **Claude Code** utilisé comme runtime d'agent, un abonnement **Claude Max** existant, et un dossier de fichiers markdown versionnés en git comme mémoire.

```
┌─────────────────────────────────────────────┐
│           Utilisateur (terminal)            │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              Claude Code CLI                │
│   (runtime d'agent, auth via abo Max)       │
└────┬─────────────┬──────────────┬───────────┘
     │             │              │
     ▼             ▼              ▼
┌─────────┐  ┌───────────┐  ┌──────────────┐
│CLAUDE.md│  │ memory/   │  │  MCPs        │
│(const.) │  │(markdown) │  │ Notion/Gmail │
└─────────┘  └───────────┘  └──────────────┘
```

Aucun backend, aucune base de données, aucune clé API. Le code de l'utilisateur = des fichiers markdown.

## Stack

| Couche | Choix MVP | Raison |
|---|---|---|
| Runtime d'agent | Claude Code | Déjà installé, couvert par abo Max, zéro dev |
| Mémoire | Fichiers markdown + git | Lisible, versionné, diffable, zéro infra |
| Config agent | `CLAUDE.md` racine | Chargé à chaque session |
| Intégrations externes | MCPs (Notion, Gmail) | Standard, maintenus par tiers |
| Process métier | Skills Claude Code | Zéro code, markdown structuré |
| Interface | CLI (terminal) | Point de départ, autres interfaces plus tard |
| Secrets | `.env` local, hors git | Classique |

## Structure de dossiers cible

```
baloo/
├── CLAUDE.md              ← "constitution" de l'assistant (< 300 lignes)
├── doc/                   ← ce dossier : conception, décisions, refs
├── sgdf-core/             ← générique SGDF (potentiellement partageable)
│   ├── glossaire.md
│   ├── compta-process.md
│   └── structure-groupe.md
├── mon-groupe/            ← spécifique à NOTRE groupe (jamais partagé)
│   ├── asso.md
│   ├── personnes.md
│   ├── comptes.md
│   └── historique/
├── skills/                ← process métier exécutables
│   ├── remboursement/
│   │   └── SKILL.md
│   ├── adhesion/
│   └── cloture-camp/
├── inbox/                 ← zone de dépôt (pdfs, captures, exports) — gitignored
└── .gitignore
```

La séparation `sgdf-core/` vs `mon-groupe/` est la seule décision structurelle prise dès le jour 1 qui coûte cher à rattraper plus tard.

## Intégrations externes

| Système | Priorité | Mode | Mécanisme |
|---|---|---|---|
| Notion | P0 | Lecture | MCP officiel Notion |
| Gmail (asso) | P0 | Lecture | MCP Gmail |
| Airtable | P1 | Lecture | MCP ou API directe |
| Spreadsheets (Google Sheets) | P1 | Lecture | MCP ou API |
| Gmail | P2 | Écriture (brouillons) | MCP Gmail |
| Compta-Web (SGDF) | P2 | Copilote manuel | Instructions à l'utilisateur |
| Compta-Web (SGDF) | P2 | Client API (lecture + écriture dépense/recette) | Reverse engineering de l'API interne, intégré au MCP `baloo-compta`. Cf. [ADR-011](decisions.md) et [`comptaweb-api.md`](comptaweb-api.md). |
| WhatsApp | P3 | Lecture | À cadrer (légal + technique) |

P0 = MVP, P1 = dès que MVP stable, P2 = quand confiance établie, P3 = plus tard / incertain.

## Pourquoi pas d'Agent SDK au MVP

L'Agent SDK est une bibliothèque Python/TS qui permet d'embarquer un agent Claude dans son propre programme. Utile dès qu'on veut **un service qui tourne sans l'utilisateur devant l'écran** (bot, cron, webapp).

Pour le MVP, Claude Code est déjà un agent complet, entièrement couvert par l'abo Max, et n'impose aucune ligne de code. L'Agent SDK deviendra pertinent en phase 3 (webapp / SaaS éventuel) — voir [`roadmap.md`](roadmap.md).

## Ce qui est volontairement exclu du MVP

- Base de données (Postgres, SQLite, vector store).
- Hébergement / VPS.
- Webapp, mobile app, bot.
- Auth, multi-tenant.
- Vector embeddings.
- Framework de mémoire type Mem0 / Letta / LangChain.
- Automatisations autonomes (cron, webhooks).

Chacun de ces éléments a une phase assignée dans la [roadmap](roadmap.md) et sera introduit **seulement si** l'usage réel le justifie.
