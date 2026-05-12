# Changelog

Tous les changements notables sont documentés ici. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage par phases (cf. [`doc/roadmap.md`](doc/roadmap.md)).

## [Unreleased]

### À venir

- Activation terrain P2 : ≥ 2 chefs d'unité actifs, ≥ 1 parent connecté.
- Onboarding multi-groupes (P3).

---

## [P2.3 — Budgets par unité] — 2026-05-11

Pilotage budgétaire par unité (Farfadets / LJ / SG / Pi / Co / Groupe).

### Ajouts

- **Vue par unité** (PR #9) : grille de cartes UnitéCard avec solde, alertes, lien détail.
- **Page détail unité** : KPI, écritures, remboursements, audit couverture `unite_id`.
- **Budgets prévisionnels** (PR #10) : table `budget_lignes` avec `activite_id`, page `/budgets` avec édition inline, agrégation prévu/réel par unité.
- **Répartitions inter-unités** (PR #11) : table `repartitions_unites`, drawer client, validation pure, agrégation net par unité.
- **KPI Réalloc** sur synthèse : solde net après répartitions par unité.
- ADRs : [ADR-029](doc/decisions.md), [ADR-030](doc/decisions.md).

---

## [P2.2 — Workflows internes] — 2026-05-04

Les workflows self-service pour ouvrir l'app aux chefs d'unité et parents.

### Ajouts

- **Dépôt de justificatif** : upload depuis l'app par chef d'unité, association à une écriture, statuts.
- **Remboursements** : feuille multi-lignes, 5 statuts (`brouillon`, `soumis`, `valide`, `paye`, `archive`), génération PDF, signature électronique (SES + chaînage interne), édition.
- **Abandons de frais** : workflow CERFA, deadline 15 avril N+1, validation par trésorier.
- **Caisse espèces** enrichie : sync Comptaweb, archivage soft-delete des doublons Airtable.
- **Gestion membres** : rôles V2 (`tresorier`, `RG`, `chef`, `equipier`, `parent`), invitations magic-link, scope filtré.
- **Page `/moi`** : remboursements et abandons d'un user, reçu fiscal pour donateurs.
- **Journal d'erreurs interne** `/admin/errors`.
- **PWA** installable Chrome / iOS.
- **Design system v5** : « carnet du trésorier », Bricolage Grotesque + Geist, bleu marine SGDF.

### Corrigés

- FK `""` vs `null` : audit + défense systémique contre les chaînes vides insérées dans des FK.
- Encoding CSV Comptaweb : Windows-1252, pas UTF-8.
- Matching cascade UPSERT à l'import : conservation des ventilations distinctes au même tuple `(date, montant, type, pièce, description)`.

---

## [P2.1 — Pivot webapp] — 2026-04 → 2026-05

La webapp Next.js devient la source de vérité opérationnelle. Le MCP `baloo-compta` est refondu en client HTTP.

### Ajouts

- **API HTTP** : routes `web/src/app/api/` pour toutes les opérations métier (écritures, remboursements, abandons, caisse, dépôts, justifs, Comptaweb).
- **MCP `baloo-compta` réécrit en client HTTP** : plus de `better-sqlite3`, plus de SQL en dur côté MCP. Auth par token API.
- **Auth multi-user** : NextAuth v5 + magic link email + token MCP. [ADR-014](doc/decisions.md).
- **Hébergement Vercel** : déploiement continu. [ADR-018](doc/decisions.md).
- **BDD Turso (libSQL)** : migration depuis SQLite local. Refacto async sur 76 fichiers. [ADR-017](doc/decisions.md).
- **Stockage justifs Vercel Blob** : migration depuis filesystem local, URLs signées privées.
- **Email transactionnel Resend** : magic link auth, notifs workflows.

### Retirés

- Accès BDD direct depuis le MCP `compta/` (`better-sqlite3`, `db.ts`, `schema.sql`).

---

## [P1 — MVP CLI] — 2026-01 → 2026-04

L'auteur utilise Baloo dans Claude Code via le MCP `baloo-compta`, en local sur SQLite.

### Ajouts

- **MCP `baloo-compta`** : 60+ outils MCP (écritures, remboursements, abandons, caisse, chèques, justificatifs, todos, personnes, comptes, budgets, notes, vue_ensemble).
- **Schéma SQL multi-tenant** : `groupes`, `users`, `personnes`, `unites`, `categories`, `comptes_bancaires`, `ecritures`, etc. Tout préfixé `group_id`. [ADR-013](doc/decisions.md).
- **Client Comptaweb** : auth Keycloak automatisée (OIDC + Symfony login), lecture écritures, lignes bancaires non rapprochées avec sous-lignes DSP2. [ADR-011](doc/decisions.md), [ADR-012](doc/decisions.md).
- **Import CSV Comptaweb** : matching cascade UPSERT, mapping `comptaweb_nature` → `category_id`, encoding Windows-1252.
- **Workflow drafts** : scan Comptaweb + sync vers Comptaweb depuis l'app.
- **Pré-commit hook anti-fuite** : bloque les commits qui contiennent des données nominatives (`data/`, `inbox/`, `justificatifs/`, `mon-groupe/`).
- **Sync référentiels Comptaweb** : branches, natures, activités, modes de paiement.
- **`sgdf-core/`** : connaissances génériques SGDF (glossaire, skill `remboursement`).
- **MCP Gmail/Workspace** en lecture seule.

### Décisions clés

- [ADR-007](doc/decisions.md) — Compta-Web reste maître, Baloo devient l'amont opérationnel.
- [ADR-010](doc/decisions.md) — SQLite + serveur MCP TypeScript.
- [ADR-013](doc/decisions.md) — multi-user dès le schéma, rien de user-dépendant en git.

---

## [0.0.0 — Bootstrap] — 2026-01

- Init du repo, vision, ADRs initiaux, structure `doc/` / `sgdf-core/` / `skills/` / `compta/`.
- Licence MIT.
- README public.

[Unreleased]: https://github.com/benomite/baloo/compare/main...HEAD
