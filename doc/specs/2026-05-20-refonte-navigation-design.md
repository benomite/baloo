# Spec — Refonte de la navigation (sidebar + app mobile membre)

**Date** : 2026-05-20
**Statut** : design validé, prêt à plan d'impl
**Sujet** : réorganiser la navigation de Baloo autour de deux expériences distinctes (poste de pilotage trésorier sur desktop, app membre sur mobile), ajouter une page d'aide à l'installation du connecteur MCP, et unifier les formulaires de demande.

---

## Contexte

La sidebar actuelle (`web/src/components/layout/sidebar.tsx`) est devenue fouillis : 5 sections (`Accueil`, `Comptabilité`, `Demandes`, `Espace chef`, `Administration`) organisées par entité technique, qui mélangent les rôles. Plusieurs items n'ont pas de filtre `roles` (Écritures, Remboursements) et fuitent vers les non-trésoriers. Des pages existent hors nav (`/import`, `/cloture`, `/comptaweb/rapprochement`, `/depots`). Pour un équipier ou un parent, l'app ressemble à un outil de compta tronqué plutôt qu'à un espace personnel simple.

Le pivot V1 ([ADR-031](../decisions.md#adr-031--baloo-miroir-strict-de-comptaweb--mcp-first)) acte que le trésorier pilote sa compta **depuis Claude.ai via le MCP** : le front desktop est un compagnon visuel, pas l'interface primaire. En parallèle, la Phase 2 du pivot vise l'activation terrain (≥2 chefs + ≥1 parent), qui passe par une app mobile simple pour les membres.

## Objectifs

1. **Deux expériences claires** : un poste de pilotage trésorier (desktop) et une app de terrain membre (mobile), au lieu d'une sidebar unique qui essaie de tout faire.
2. **Simplifier radicalement les non-trésoriers** : un membre ouvre l'app 2-3 fois par an pour déposer un justif ou suivre une demande. Zéro vocabulaire comptable.
3. **Ranger l'app trésorier par intention** (ce qu'on veut faire) plutôt que par entité technique.
4. **Aider à installer le MCP** : une page guide pas-à-pas pour connecter Baloo comme connecteur dans Claude.
5. **Unifier les formulaires de demande** dupliqués (`/remboursements/nouveau` vs `/moi/...`).

## Non-objectifs

- **Vue budget d'unité pour le chef** : on réserve l'emplacement (carte « Mon unité »), mais l'écran lui-même est un chantier séparé.
- **Refonte du dashboard `/`** : le contenu « ce qui va / pas » est la Phase 4 du pivot. Ici on ne touche qu'à la nav et au cadre.
- **Captures/gif dans la page MCP** : prévu plus tard, pas en V1 de cette refonte.
- **Permissions fines sur le champ demandeur** : assumé ouvert (cf. § Formulaires unifiés).

---

## Principe directeur

> **Le viewport décide de l'expérience ; le rôle décide du contenu.**

- **Mobile = l'app de terrain**, centrée sur le dépôt de justificatifs, pour *tous* les rôles (trésorier compris). Bottom-nav simple.
- **Desktop = le poste de pilotage**, fonctions de gestion/compta. Sidebar rangée par intention. Pertinent surtout pour `tresorier`/`RG`.
- Un trésorier sur mobile se comporte comme un membre (déposer un justif) ; les fonctions de gestion lui restent accessibles **en secondaire** (onglet « Plus »).

**Modèle technique** : responsive + rôle, un seul code. La nav s'adapte au viewport (CSS breakpoints, comme l'actuel `lg:`) et au rôle (filtrage des items). Pas de duplication d'app.

---

## App membre (mobile)

Bottom-nav à 3 onglets, « Déposer » mis en avant au centre :

```
🏠 Accueil        📎 Déposer        📋 Mes demandes
```

- **Accueil** : salutation, raccourcis vers les 2 actions, aperçu des demandes en cours.
- **Déposer** : upload photo/fichier + champs minimaux (date, montant, intitulé, unité concernée, qui a payé).
- **Mes demandes** : historique remboursements/dons avec statut (en attente / remboursé / refusé).

Variantes par rôle, même squelette :

| Rôle | Adaptation |
|---|---|
| `equipier` | Les 3 onglets standard. |
| `parent` | Onglet « Déposer » → « Mes reçus » (consultation reçus fiscaux + remboursements). Le plus réduit. |
| `chef` | + carte « Mon unité » sur l'Accueil (suivi budget simple — *emplacement réservé, écran ultérieur*). |
| `tresorier` / `RG` | Les 3 onglets membre + un 4e onglet **« Plus »** qui ouvre l'accès secondaire au pilotage (renvoie vers les pages desktop). |

L'app mobile reste une PWA (déjà en place). La bottom-nav est `sticky bottom-0`, masquée sur `lg+` (desktop) où la sidebar prend le relais.

---

## App trésorier (desktop, sidebar par intention)

Quatre groupes d'intention remplacent les 5 sections actuelles :

```
👁 Piloter            🏠 Accueil · 📥 Inbox · 📊 Synthèse · 🧮 Budget
✍ Saisir             📒 Écritures · 💰 Caisse · 🔗 Rapprochement
🤝 Demandes & dépôts  🪙 Remboursements · 🎁 Dons au groupe · 📦 Dépôts
⚙ Gérer              🤖 Connexion Claude · 👥 Membres · 🩺 Journal · Aide
```

- **Piloter** = consultation / hub quotidien (le dashboard est le point d'entrée).
- **Saisir** = interfaces assistées Comptaweb (écritures, caisse, rapprochement DSP2).
- **Demandes & dépôts** = workflows multi-personnes.
- **Gérer** = setup & admin, dont la nouvelle page Connexion Claude.

Footer sidebar conservé : bouton install PWA + `<SyncStatusButton>` (admins). L'item « Aide » remonte dans Gérer.

**Hors navigation** (accessibles par lien direct, pas dans la sidebar) :
- `/import` — import CSV, déprécié depuis le pivot miroir strict.
- `/cloture` — clôture annuelle (~1×/an), sera rappelée par le dashboard en fin d'exercice.

Les autres pages aujourd'hui orphelines restent rattachées : `/comptaweb/rapprochement` → Saisir, `/depots` → Demandes & dépôts.

### Rôle `chef` côté desktop

Le `chef` n'a pas le poste de pilotage complet. Sur desktop, il voit une sidebar réduite (Synthèse + Budget de son unité, en lecture, déjà scopés via `COMPTA_ROLES` + `scope_unite_id`). Son expérience principale reste l'app membre mobile.

---

## Page « Connexion Claude / MCP »

Évolution de `web/src/app/(app)/moi/connexions/page.tsx`, déplacée/liée sous **Gérer**. Réservée à `tresorier`/`RG`. Structure :

1. **Pitch** : « Pilote ta compta depuis Claude » + exemples en langage naturel.
2. **Prérequis** : compte Claude autorisant les connecteurs personnalisés (Pro / Max / Team).
3. **Installation en 4 étapes** :
   1. Copier l'URL du connecteur (`https://baloo.benomite.com/api/mcp`, bouton copier).
   2. Claude → Réglages → Connecteurs → Ajouter un connecteur personnalisé → coller l'URL.
   3. Autoriser l'accès (login OAuth, renvoi sur Baloo).
   4. Tester (« Montre-moi la vue d'ensemble de la trésorerie »).
4. **Exemples de prompts** : courte liste « que demander à Claude » (lister les justifs manquants, lancer une sync, créer une dépense…).
5. **Apps connectées** : liste des tokens OAuth actifs + révocation (l'existant, conservé).

Uniformiser le wording « Claude Desktop » → « Claude (web ou Desktop) » (le pivot cible Claude.ai web en priorité).

---

## Formulaires de demande unifiés

Aujourd'hui deux formulaires dupliqués par rôle :
- `/remboursements/nouveau` (trésorier, choisit le demandeur)
- `/moi/remboursements/nouveau` (membre, demandeur = soi)

Idem pour les abandons (`/abandons/nouveau` vs `/moi/abandons/nouveau`).

**Cible** : un seul formulaire par type. Le champ « demandeur » est **prérempli avec l'utilisateur connecté** mais **modifiable par tous les rôles**. Les routes `/moi/remboursements/nouveau` et `/moi/abandons/nouveau` redirigent vers le formulaire unifié (ou sont supprimées si plus référencées).

**Décision assumée** : pas de gate de permission sur le champ demandeur — n'importe quel rôle peut saisir une demande au nom d'un autre. Simplicité prioritaire ; le périmètre de Baloo est un groupe de confiance.

---

## Architecture technique

```
web/src/components/layout/
  sidebar.tsx          → desktop : 4 groupes d'intention, items filtrés par rôle
  mobile-nav.tsx       → remplacé/complété par une bottom-nav membre
  bottom-nav.tsx       (nouveau) → 3 onglets membre + onglet "Plus" conditionnel (admins)
```

- La structure de nav (groupes, items, rôles) est décrite dans une **donnée unique** (le `SECTIONS` actuel, restructuré) consommée par la sidebar desktop ET la bottom-nav mobile, pour éviter deux sources de vérité.
- Breakpoints : sidebar visible `lg+`, bottom-nav visible `< lg`. Cohérent avec le pattern responsive actuel (`lg:flex`, `lg:hidden`).
- Filtrage par rôle : helper centralisé (réutilise `ADMIN_ROLES` / `COMPTA_ROLES` / `SUBMIT_ROLES` de `lib/auth/access.ts`).
- Le `(app)/layout.tsx` orchestre : sidebar desktop OU bottom-nav mobile selon viewport, contenu selon rôle.

### Unités de découpage

| Unité | Rôle | Dépend de |
|---|---|---|
| `nav-config.ts` | Source de vérité : groupes, items, icônes, rôles, badges | `lib/auth/access.ts` |
| `sidebar.tsx` | Rendu desktop (4 groupes) | `nav-config` |
| `bottom-nav.tsx` | Rendu mobile membre + onglet Plus | `nav-config` |
| `connexion-mcp` (page) | Guide install MCP + apps connectées | `oauth-access-tokens`, `issuer` |
| formulaire demande unifié | 1 form remb + 1 form abandon, demandeur préremplie | services rembs/abandons existants |

---

## Migration / impact

- **Pas de migration BDD** : refonte purement front + routes.
- **Routes supprimées/redirigées** : `/moi/remboursements/nouveau`, `/moi/abandons/nouveau` → formulaire unifié.
- **Routes sorties de la nav** (code conservé) : `/import`, `/cloture`.
- **Tests** : RTL sur la bottom-nav (rendu par rôle, onglet Plus admin), sur le filtrage sidebar par rôle, et sur le formulaire unifié (préremplissage + modification du demandeur). Pas de test BDD.

## Risques

| Risque | Mitigation |
|---|---|
| Double source de vérité nav (sidebar vs bottom-nav divergent) | `nav-config.ts` unique consommé par les deux. |
| Trésorier perdu sur mobile (cherche une fonction de gestion) | Onglet « Plus » explicite + accès desktop inchangé. |
| Formulaire unifié casse un parcours membre existant | Tests RTL sur le préremplissage + redirections `/moi/...`. |
| Régression visibilité (un item fuit vers un rôle non autorisé) | Filtrage centralisé + test par rôle. Corrige aussi le bug actuel (Écritures/Remboursements sans `roles`). |

## Décisions structurantes à acter

À l'issue de l'implémentation, créer un ADR capturant :
- « Viewport décide l'expérience, rôle décide le contenu » (responsive + rôle, pas deux apps).
- « Mobile = app membre pour tous ; desktop = poste de pilotage trésorier ».
- « App trésorier rangée par intention (Piloter / Saisir / Demandes&dépôts / Gérer) ».
- « Formulaires de demande unifiés, demandeur prérempli modifiable par tous ».
