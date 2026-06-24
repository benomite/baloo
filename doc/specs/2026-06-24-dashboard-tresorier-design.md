# Dashboard trésorier (home `/`) — design

> Phase 4 du pivot miroir MCP-first (cf. [`2026-05-18-baloo-miroir-mcp-first-design.md`](2026-05-18-baloo-miroir-mcp-first-design.md), §« Phase 4 — Dashboard + mémoire structurée »). Cadré le 2026-06-24, au démarrage de l'activation terrain (2 parents en remboursement, chefs farfadets + louveteaux sur les camps).

## Contexte

Aujourd'hui, le trésorier (`tresorier` / `RG`) qui ouvre Baloo est **redirigé vers `/ecritures`** (`web/src/app/(app)/page.tsx:64`). Il n'a aucune vue agrégée « qu'est-ce qui attend mon action » ni « où en est la compta ». Les notifs email (livrées le 2026-06-19, commit `0c6f109`) le préviennent dépôt par dépôt, mais ne remplacent pas une home de pilotage — d'autant que l'activation terrain va générer un flux de demandes (rembs parents, dépôts chefs).

La home didactique par rôle existe déjà pour `chef` / `membre` (livrée le 2026-06-17). Ce chantier ajoute **le volet trésorier manquant** sur la même route `/`.

## Objectif

Une home `/` pour le trésorier répondant en un coup d'œil à deux questions :
1. **Qu'est-ce qui attend mon action ?** (bloc « à traiter », en haut)
2. **Où en est la compta ?** (bloc « santé », en dessous)

## Non-objectifs (V1)

- Pas de seuils d'alerte paramétrables (ex. « remb > 7j = rouge »). La spec mère les mentionne ; YAGNI tant que le besoin terrain n'est pas constaté. Coloration uniquement sur `count > 0` / dépassement budget / sync stale.
- Pas de nouvelles vues de liste : toutes les cartes pointent vers des pages existantes.
- Pas de modification de la home didactique `chef` / `membre`.
- Pas de graphiques/historique : photo de l'instant uniquement.

## Routing

`/` reste conditionnel au rôle (`web/src/app/(app)/page.tsx`) :

- **`tresorier` / `RG`** → dashboard rendu inline. On **supprime** le `redirect('/ecritures')` (ligne 64). `/ecritures` reste accessible via la nav.
- **`chef` / `membre`** → home didactique actuelle, **inchangée**.

`export const dynamic = 'force-dynamic'` est déjà en place (lecture cookies/auth) — conserver.

## Architecture

### Couche données — `lib/services/dashboard.ts`

Un service `getDashboardData(ctx)` qui agrège en une seule passe server-side (`Promise.all`) :

- `getOverview()` (`lib/services/overview.ts`) — **réutilisé tel quel** : trésorerie (recettes − dépenses sur l'exercice), remboursements en attente (`count` + `total`), dépenses sans justif (`depensesSansJustificatif`), budgets par unité (`unites[]`), non-sync Comptaweb (`nonSyncComptaweb`).
- 3 compteurs ciblés à ajouter :
  - **dépôts membres à rapprocher** — justifs déposés via `/depot` non encore reliés à une écriture (`lib/services/depots.ts`).
  - **abandons à traiter** — abandons en attente de validation / émission CERFA (`lib/services/abandons.ts`).
  - **lignes bancaires non rapprochées** — drafts CW (`lib/services/drafts.ts` / `cw_list_rapprochement_bancaire`).
- `sync_status` — dernière sync, `stale` (déjà exposé).

Retour : objet plat `{ aTraiter: {...}, sante: {...} }`. Les nouveaux compteurs SQL respectent les conventions (catégories = référentiel national sans `group_id` ; pas de DELETE ; comptage simple).

### Présentation — `web/src/app/(app)/page.tsx`

Composants serveur, réutilisant `Section`, `SectionHeader`, `Amount`, les status badges et le pattern `ActionCard` existants (design system « carnet du trésorier »). Aucun nouveau langage visuel.

## Les cartes

### Bloc « À traiter » (actions)

Chaque carte : icône + compteur + total € éventuel + lien vers la liste filtrée.

| Carte | Compteur | Destination |
|---|---|---|
| Rembs à valider/payer | status `demande` + `valide` | `/remboursements?status=demande` |
| Dépôts membres à rapprocher | justifs déposés non liés | `/depots` |
| Dépenses sans justif | `getOverview.depensesSansJustificatif` | `/inbox` (rapprochement orphelins) — à confirmer en lisant le code, fallback `/ecritures` |
| Abandons à traiter | en attente validation/CERFA | `/abandons` |
| Lignes bancaires non rapprochées | drafts CW | `/comptaweb/rapprochement` |

### Bloc « Santé » (pilotage)

| Carte | Contenu | Destination |
|---|---|---|
| Trésorerie globale | solde exercice (recettes − dépenses) | `/ecritures` |
| Engagement rembs | total € en attente (dette familles) | `/remboursements` |
| Budgets par unité | dépenses vs prévu, dépassement en rouge | `/budgets` |
| État sync Comptaweb | dernière sync, à jour / stale, nb non-synchro | `/comptaweb/rapprochement` |

## Hiérarchie visuelle (règle « ce qui va / pas »)

- **Bloc à traiter en haut.** Carte `count > 0` = mise en avant (bordure / teinte d'accent). Carte `count == 0` = atténuée ou repliée en une ligne « ✓ rien à traiter ».
- Si **tout** le bloc à traiter est à zéro → état compact « Tout est à jour 👍 » au lieu de 5 cartes vides.
- **Bloc santé** : ton neutre, sauf **dépassement budget** (rouge) et **sync stale** (ambre).

## Error handling

- `getDashboardData` ne doit jamais faire planter la home : chaque sous-agrégat (overview, dépôts, abandons, drafts, sync) résolu indépendamment ; l'échec d'un bloc dégrade en « — » sur sa carte plutôt que de casser la page (cf. piège « enrichissement multi-référentiels : résoudre chaque champ indépendamment », `web/AGENTS.md`).
- Wrapper les `await` via `logError` si une carte plante en prod, le temps du diagnostic.

## Tests

- `getDashboardData` : module testable (vitest) sur les compteurs dérivés, façon `km.test.ts` / `ecritures-status.test.ts`.
- 3 nouveaux compteurs SQL testés sur **BDD de test isolée** (jamais `data/baloo.db`).
- Pas de test E2E ; vérification manuelle en prod-like avec les comptes d'activation terrain.

## Points ouverts (tranchés par défaut)

1. **Destination « dépenses sans justif »** : viser `/inbox` (rapprochement justifs orphelins) ; confirmer en lisant le code, fallback `/ecritures`.
2. **Pas de seuils paramétrables** en V1 (cf. Non-objectifs).
