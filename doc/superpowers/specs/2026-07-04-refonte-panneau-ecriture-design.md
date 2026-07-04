# Refonte du panneau de détail d'une écriture (+ suppression de la page détail)

**Date** : 2026-07-04
**Statut** : design proposé — en attente de relecture (3 défauts retenus à confirmer, cf. §Décisions)

## Problème

Le panneau qui s'ouvre au clic sur une écriture dans la liste (`ecriture-inline-panel.tsx`) est trop grand, oblige à scroller, et ne priorise pas les champs. Constats concrets :

1. **Même formulaire lourd quel que soit l'état.** Une écriture `mirror` (synchronisée, non modifiable) rend le form complet en `disabled` + bandeau « verrouillé » + readiness + Notes + justif + cycle de vie.
2. **Ordre à contre-emploi.** Pour un brouillon issu de la banque, le travail = l'imputation (unité/catégorie/activité), mais le form affiche « Identité » (date/type/description/montant/n° pièce, surtout donnés par la banque) en premier.
3. **Trop de chrome.** Bandeau readiness sur 2 lignes même quand « prêt » ; case « justif attendu » avec 3 lignes d'aide ; sous-titres de section ; `space-y-6` ; submit `lg` ; deux bandeaux (origine banque + mode CW).
4. **Action principale enterrée** (Valider/Enregistrer tout en bas).
5. **Doublon divergent** avec la page `/ecritures/[id]` — deux implémentations à maintenir ; le lien « Page complète » est l'aveu que l'inline ne suffit pas.

## Objectifs

- Panneau **compact, priorisé, adapté à l'état**, action principale toujours à portée.
- **Supprimer la vue détail distincte** : une seule implémentation, réutilisée partout.
- **Zéro régression fonctionnelle** : tout ce que fait la page détail reste accessible.

## Non-objectifs

- Pas de refonte du modèle de données ni du cycle de sync CW.
- Pas de refonte du wizard de création (`/ecritures/nouveau`) — hors périmètre.
- Pas d'autosave (on garde une sauvegarde explicite ; cf. §Comportements).

## Architecture

### Un composant panneau unique, réutilisable et autonome

Le panneau devient **le** rendu du détail d'une écriture, utilisable de deux façons :
- **inline** sous une ligne de la liste (clic sur la ligne) ;
- **épinglé** en haut de la liste quand on arrive via un lien profond (`?open=<id>`), y compris si l'écriture n'est pas dans la page chargée (pagination) — dans ce cas le panneau **charge lui-même son détail** par id.

Un seul `openId` à la fois dans la liste : s'il correspond à une ligne chargée → rendu inline sous la ligne ; sinon → rendu épinglé en haut (fetch autonome). Plus de composant/page détail séparé à maintenir.

### Suppression de la page `/ecritures/[id]`

**Défaut retenu (à confirmer) : redirection.** La route `/ecritures/[id]/page.tsx` ne rend plus la vue bespoke ; elle **redirige** vers `/ecritures?open=<id>`. Bénéfices : tous les liens entrants continuent de marcher (remboursements, camps, `ecriture-link-card`, redirections serveur `attachDepotFromEcriture`/`shareDepotFromEcriture`, `router.push` après création, cmd-clic « ouvrir dans un onglet » depuis la table). Aucun 404, aucune redirection serveur à réécrire.

Le paramètre `?open=<id>` est lu par la page liste pour ouvrir le panneau correspondant.

### Parité — fonctions à rapatrier de la page détail vers le panneau

Aujourd'hui uniquement dans `/ecritures/[id]` :
- **« Tout copier » (`CwAssistActions`)** — copier les champs pour les coller dans Comptaweb. → dans le menu `⋯` (section CW).
- **Relance justif par email (`RelanceCard`, `sendRelance`)** — admin, si justif manquant. → bloc repliable dans la zone justif (admin only).
- **Lien vers le remboursement justifiant** (`remboursement_id`). → puce dans le header/justif.
- **Bandeau « mode CW » / info mirror** (`CwAssistInfoBanner`). → condensé dans la puce d'état (pas un gros bandeau).

## Layout par état

### Header (tous états) — compact, une à deux lignes
`[ description (titre éditable inline si draft) ]   [montant coloré] · [date]`
`[puce d'état] · [origine banque #id si applicable]           [⋯] [×]`

- La **puce d'état** remplace la grosse `ReadinessBanner` : `● Brouillon` / `🔒 Synchro CW` / `⚠ À compléter`. Détail readiness (liste des manques) en hint compact sous l'imputation, pas en boîte.
- `⋯` = menu des actions secondaires (voir §Menu).

### Brouillon issu de la banque (cas courant) — le travail d'abord
Ordre : **Imputation → Justif → barre d'action**. L'identité (date/type/montant/n° pièce) est **donnée par la banque** → démotée derrière ‹ Détails › (menu `⋯` ou expander). La **description** reste éditable en header (titre parlant).

- **Imputation** (défaut retenu : **2 colonnes responsive**) : Unité | Catégorie, Activité | Mode, Carte | case « justif attendu » (version compacte, sans les 3 lignes d'aide — un `title`/tooltip suffit).
- **Justif** compact : liste fichiers + `[+ fichier]` `[Réutiliser]` (+ `[Rattacher dépôt]` si dépôts a_traiter) ; bloc relance repliable si manquant (admin).
- Hint incomplet : une ligne `⚠ manque : unité, catégorie` (pas une boîte).

### Brouillon saisi à la main (pas d'origine banque)
L'identité **redevient prioritaire** (montant/date/type = le travail) : Identité en 2 colonnes en haut, puis Imputation. Même compacité.

### Mirror / divergent (lecture seule) — résumé dense, pas de form
Pas de formulaire désactivé. **Résumé en liste dense** : `Unité · Catégorie · Activité · Carte`, `n° pièce`, justif. Actions : `[Copier pour CW]` `[Resync]`, relance si justif manquant. Les champs Baloo-only encore éditables (notes, `justif_attendu`) restent accessibles via `⋯`.

### pending_sync
Proche du mirror (résumé), plus l'action `Valider`/`Marquer miroir`/`Sync`.

### Divulgation progressive (défaut retenu : **agressif**)
À l'ouverture d'un brouillon banque : **imputation + justif + Valider** seulement. Derrière ‹ Détails ›/`⋯` : édition date/type/montant/n° pièce, **Notes**, Copier-pour-CW, réparations de cycle de vie (repasser brouillon, marquer miroir), suppression.

### Barre d'action collante (bas du panneau)
Action primaire selon l'état : `draft` → **Valider** (et Enregistrer si champs modifiés) ; `pending_sync` → **Sync / Marquer miroir** ; `mirror` → **Copier pour CW**. `sticky bottom-0` dans le panneau, toujours atteignable sans scroller.

### Menu `⋯` (actions secondaires)
Regroupe : Éditer l'identité (draft) · Notes · Copier pour CW · Repasser brouillon · Marquer miroir CW · Supprimer le brouillon (draft, garde-fous) · Ouvrir la ligne bancaire. Évite d'empiler ces actions rares en permanence.

## Comportements

- **Sauvegarde explicite** (pas d'autosave) : un bouton Enregistrer apparaît quand un champ est modifié ; sinon l'action primaire (Valider…) est mise en avant. `updateEcriture` + `refreshRow` existants réutilisés.
- **Titre éditable inline** dans le header (draft) : clic → input, blur/Enter → save (réutilise le nudge `titre_a_renommer`).
- **Fermeture** : `×` ou Échap ; via `?open` un `×` retire le param de l'URL.
- **Chargement** : le fetch `fetchEcritureDetail` existant alimente justifs/dépôts ; en mode épinglé il fournit AUSSI l'écriture fraîche (le panneau autonome n'a pas de ligne source).

## Composants (esquisse)

- `EcritureInlinePanel` (refonte) : orchestration + états ; découpé en sous-blocs :
  - `EcritureHeaderCompact` (titre inline, montant/date, puce état, `⋯`, `×`).
  - `EcritureImputationFields` (2-col, extrait de `EcritureFormFields`).
  - `EcritureIdentityFields` (date/type/montant/n° pièce — repliable).
  - `EcritureReadonlySummary` (mirror/divergent).
  - `JustificatifsCard` (déjà là, à compacter) + relance repliable.
  - `EcritureActionsMenu` (`⋯`) + `EcritureStickyActions`.
- `EcrituresInfiniteList` : gère `openId` + rendu épinglé quand la ligne n'est pas chargée ; lit `?open`.
- `/ecritures/[id]/page.tsx` : réduit à un `redirect('/ecritures?open=' + id)`.

## Préservation / garde-fous
- Aucune action serveur supprimée : `updateEcriture`, `updateEcritureStatus`, sync/resync/delete draft, relance, CwAssist, attach/share dépôt — toutes conservées, juste réorganisées.
- Verrouillage inchangé : champs sync en lecture seule si `mirror`/`divergent`.
- Suppression draft : garde-fous serveur inchangés.

## Décisions (défauts retenus, à confirmer)
1. **Page détail** → *redirection* vers `/ecritures?open=<id>` (vs full-page du panneau / suppression dure).
2. **Divulgation** → *agressive* (identité banque + notes + secondaire repliés par défaut).
3. **Imputation** → *2 colonnes responsive*.

## Tests
- `computeReadiness` / mapping des manques : inchangé (réutilisé), couvert.
- Rendu par état (draft banque / draft manuel / mirror / pending) : tests de composant (présence imputation-first, absence de form en mirror, action primaire correcte).
- `?open=<id>` : ouvre le panneau ; id hors page → panneau épinglé qui fetch.
- Redirection `/ecritures/[id]` → `/ecritures?open=<id>`.
- Parité : Copier-pour-CW, relance, lien remboursement présents dans le panneau.

## Hors périmètre
- Wizard de création `/ecritures/nouveau`.
- Refonte du cycle de sync CW.
- Autosave.
