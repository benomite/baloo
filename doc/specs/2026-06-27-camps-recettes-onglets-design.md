# Vue camp : onglets Dépenses / Recettes + liste des paiements — design

> Suite de [`2026-06-10-camps-design.md`](2026-06-10-camps-design.md) (camps + avances). V1 du suivi des paiements familles, demandé le 2026-06-27. Cadré en mode assistant→produit (brainstorming).

## Contexte

La vue camp `/camps/[id]` agrège aujourd'hui, dans un flux unique : le **budget dépenses** (prévu vs réalisé par poste), les **avances de trésorerie**, les **écritures de dépense** du camp, les **justifs manquants**, et une petite Section **« Recettes »** qui montre uniquement le **total encaissé vs prévu** (barre de progression), sans détail.

Le trésorier a besoin de **suivre les paiements des familles par camp** pour repérer les impayés. La matière est déjà en compta : les paiements sont des écritures de **recette** imputées sur le camp (activité × unité). Il manque (a) le **détail** ligne par ligne de ces recettes, et (b) une **séparation claire** dépenses / recettes dans la vue.

## Objectif

Réorganiser `/camps/[id]` en **2 onglets** — **Dépenses** et **Recettes** — et, côté Recettes, afficher la **liste détaillée des paiements reçus** (en plus du total encaissé / prévu déjà présent).

## Non-objectifs (V1)

- Pas de liste nominative des inscrits, pas de suivi « tel inscrit n'a pas payé » au niveau individuel.
- Pas de barème quotient familial (le montant attendu reste le total prévisionnel du budget).
- Pas de saisie ni de rapprochement nominatif : V1 = **miroir de la compta**, consultation seule.
- Pas de nouvelle table : on lit l'existant (`camps`, `budget_lignes`, `ecritures`).

## Données

`CampBudgetRows` fournit **déjà** `totalBudgetRecettesCents` et `recettesEncaisseesCents` — la comparaison encaissé/prévu est acquise.

Ce qui manque : la **liste des écritures de recette du camp**. Aujourd'hui `ecrituresRecentes` mélange dépenses et recettes et n'est qu'un échantillon récent.

**Ajout** : une requête dédiée exposée par `getCampDashboard` (champ `recettes: EcritureCampRow[]`) — les écritures `type = 'recette'` imputées sur le camp (`activite_id = camp.activite_id AND unite_id = camp.unite_id`, mêmes bornes d'exercice et exclusions `CATEGORIES_HORS_RESULTAT` que le reste de la vue), triées par date décroissante. Réutilise le type `EcritureCampRow` existant (date, description, montant, catégorie, justif). Symétriquement, on isolera les **écritures de dépense** pour l'onglet Dépenses (soit un champ `depenses: EcritureCampRow[]`, soit on garde `ecrituresRecentes` côté dépenses si l'échantillon suffit — à trancher à l'implémentation selon ce qui sert déjà l'onglet Dépenses).

Le `sansUniteCount` existant (écritures de l'activité sans unité, invisibles du camp) reste affiché en avertissement — pertinent pour les recettes mal imputées.

## UI

`/camps/[id]` passe d'un flux unique à un **conteneur à 2 onglets** (état client local, pas de navigation `?tab=` — cohérent avec le pattern « pas de navigation pour l'état d'UI » des autres vues). Le header du camp (nom, dates, statut, actions) reste au-dessus des onglets.

**Onglet « Dépenses »** — le contenu existant, inchangé :
- Section « Budget dépenses » (postes prévu vs réalisé, barre).
- Avances de trésorerie.
- Écritures de dépense + justifs manquants.

**Onglet « Recettes »** :
- En-tête : **encaissé `recettesEncaisseesCents` / prévu `totalBudgetRecettesCents`** + barre de progression (la Section « Recettes » actuelle, déplacée ici).
- **Liste des paiements** : pour chaque écriture de recette — **date · libellé** (le payeur, via le libellé bancaire) · **catégorie** · **montant**. Triée par date décroissante. État vide explicite (« aucun paiement encaissé pour l'instant »).
- Avertissement `sansUniteCount` si > 0.

L'onglet par défaut à l'ouverture : **Dépenses** (continuité avec l'usage actuel).

## Découpage en unités

- `getCampDashboard` (service `camps.ts`) : ajouter la requête `recettes` (et éventuellement `depenses`). Pure extension SQL, pas de changement des champs existants.
- Composant client `CampTabs` (nouveau, `web/src/components/camps/`) : gère l'état onglet et rend les deux panneaux. La page `[id]/page.tsx` (server component) charge le dashboard et passe les données au composant.
- Le contenu de chaque onglet réutilise les Sections existantes (extraites en sous-composants si la page devient trop grosse).

## Error handling

Aucun chemin d'écriture introduit. Si la requête recettes échoue, l'onglet Recettes dégrade en liste vide + le reste de la vue reste fonctionnel (la requête est indépendante des autres blocs du dashboard).

## Tests

- Logique pure : la construction des totaux est déjà couverte (`camp-budget.test.ts`). Ajouter, si une transformation non triviale est introduite (tri, regroupement), un test pur dessus.
- La requête SQL `recettes` : test sur BDD in-memory (`file::memory:`) façon tests services existants — vérifier le filtre `type='recette' AND activite×unité` et les exclusions.
- Pas de test E2E ; vérification manuelle sur un camp réel.

## Hors V1 — pistes V2 (non engagées)

Liste nominative des inscrits (fournie par les chefs), montant attendu par famille (barème QF), rapprochement paiement ↔ famille, vue « impayés » au niveau individuel.
