# Spec — Vue synthèse enrichie + détail par unité

**Date** : 2026-05-10
**Statut** : design validé, prêt à plan d'impl
**Phase** : 1 (visualisation seule, pas de répartition entre unités)

---

## Contexte

Le trésorier a besoin de voir, à tout moment, où va l'argent par **unité** (= branche d'âge concrète du groupe : Farfadets, Louveteaux/Jeannettes, Scouts/Guides, Pionniers/Caravelles, Compagnons, Groupe). Aujourd'hui :

- `/synthese` montre déjà une table « Par unité » (réel agrégé), avec un liseré couleur SGDF par ligne.
- Aucune vue de **détail** par unité : pour creuser, il faut passer par `/ecritures?unite_id=...` directement.
- Les **dépenses** sont **bien renseignées** (`ecritures.unite_id` rempli correctement par les imports CSV ventilés Comptaweb).
- Les **recettes** d'inscriptions atterrissent globalement (sur l'unité « Groupe » ou `unite_id` NULL) — la réallocation par unité fera l'objet d'une phase ultérieure (cf. spec à venir sur les `repartitions_unites`).

Cette phase 1 se concentre sur la **visualisation des dépenses par unité** : améliorer la lisibilité au niveau synthèse + offrir une vue détail navigable.

## Objectifs

1. Remplacer la table « Par unité » de `/synthese` par une **grille de cartes couleur SGDF**, plus lisible et cliquable.
2. Créer une **page détail par unité** `/synthese/unite/[id]` regroupant les chiffres clés, la répartition par catégorie, et les écritures récentes.
3. Conserver le filtre par exercice SGDF (Sept→Août) déjà en place sur `/synthese` et le propager au détail.

## Hors scope (phase 1)

- Budget prévisionnel par unité (prévu vs réel) — viendra avec la spec budgets, qui devra prendre en compte la dualité **« activités d'année »** (sept→juin/juillet) vs **« camps d'été »** (juillet/août). Deux budgets par saison à modéliser.
- Évolution mensuelle des dépenses — la granularité utile pour le groupe est trimestre / camps, pas mois.
- Mécanisme de répartition / mouvement interne entre unités (table `repartitions_unites` envisagée) — phase 3.
- Édition des lignes budget — phase 2 (budgets).
- Affichage différencié des recettes par unité — dépend de la phase 3 (répartitions). Pour l'instant, les recettes restent affichées telles qu'importées (essentiellement sur « Groupe »).

## Architecture proposée

### Composants UI

```
web/src/app/(app)/synthese/
  page.tsx                        ← MODIFIÉ : table « Par unité » → <UnitesGrid>
  unite/
    [id]/
      page.tsx                    ← NOUVEAU : détail unité (server component)
      not-found.tsx               ← NOUVEAU : unité introuvable / pas dans le groupe

web/src/components/synthese/
  unites-grid.tsx                 ← NOUVEAU : grille de cartes cliquables
  unite-card.tsx                  ← NOUVEAU : 1 carte (couleur, totaux, badges)
  unite-detail-header.tsx         ← NOUVEAU : header avec liseré couleur + sélecteur exercice
```

### Données (lecture seule)

Pas de modification de schéma BDD en phase 1. On consomme les tables existantes (`unites`, `ecritures`, `categories`, `justificatifs`).

Côté `lib/services/overview.ts` :

- **Refactoring léger** : extraire les briques de calcul actuelles en helpers réutilisables (`computeTotaux`, `computeParCategorie`, `computeAlertes`) qui acceptent des contraintes additionnelles (`uniteId?: string`).
- **Nouvelle fonction** `getUniteOverview({ groupId, uniteId, exercice }) : UniteOverviewData` qui renvoie les chiffres scopés à une unité.

`UniteOverviewData` :

```ts
interface UniteOverviewData {
  unite: { id: string; code: string; name: string; couleur: string | null; branche: string | null };
  exerciceFiltre: string | null;
  totalDepenses: number;
  totalRecettes: number;
  solde: number;
  parCategorie: CategorieRow[];      // mêmes lignes que la synthèse globale, scopées
  alertes: { depensesSansJustificatif: number; nonSyncComptaweb: number };
  ecrituresRecentes: EcritureLite[]; // 50 dernières (date desc) pour la liste embarquée
  totalEcritures: number;            // pour le lien « voir toutes (N) »
}
```

Anti-énumération : si `uniteId` n'appartient pas au `groupId` courant, `getUniteOverview` retourne `null` ; la page sert un 404 (pas de fuite « existe ailleurs »).

### Routes / URLs

| Route | Méthode | Description |
|---|---|---|
| `/synthese?exercice=YYYY-YYYY+1` | GET | Synthèse globale, vue cartes par unité |
| `/synthese/unite/[id]?exercice=...` | GET | Détail d'une unité, hérite du paramètre exercice |
| `/ecritures?unite_id=<id>&...` | GET | Existe déjà ; sert de drill-down ultime |

Aucun nouvel endpoint API. Tout vit en server component (Next 16 App Router).

## Détail des écrans

### `/synthese` — section « Par unité »

**Avant** : table 4 colonnes (unité / dépenses / recettes / solde) avec liseré couleur sur fond légèrement teinté.

**Après** : grille de cartes responsive (mobile = 1 col, tablette = 2 col, desktop = 3 col).

Chaque **carte** :

- Liseré coloré gauche (3px) à la couleur charte SGDF de la branche
- Fond très légèrement teinté (`{couleur}0F` comme l'existant)
- Code + nom de l'unité (ex. « LJ-1 — Louveteaux »)
- 3 lignes de chiffres : Dépenses (rouge si > 0), Recettes (vert), Solde (signed)
- Ligne badges si applicable :
  - Badge ambre « N sans justif » si `depensesSansJustificatif > 0`
  - Badge bleu « N non sync » si `nonSyncComptaweb > 0`
- Toute la carte cliquable → `/synthese/unite/<id>?exercice=<exerciceParam>`
- Hover : élévation légère, conserve le liseré

**Ordre d'affichage** : par code unité ascendant (cohérent avec table actuelle).

**Cas vide** : pas d'unités du tout dans le groupe → message « Aucune unité importée. Lance la sync des référentiels Comptaweb. » avec lien vers `/import`.

### `/synthese/unite/[id]` — page détail

**Header**
- Breadcrumb « Synthèse / [Code unité — Nom] »
- Titre = nom de l'unité, liseré couleur charte SGDF (3px à gauche du titre)
- Sélecteur d'exercice (mêmes valeurs que `/synthese`) — préserve le filtre

**Section 1 — KPIs (3 stat cards)**
Mêmes composants que `/synthese` : Dépenses / Recettes / Solde — scopés à l'unité.

**Section 2 — Alertes (2 stat cards)**
- N écritures **sans justificatif** (cliquable → `/ecritures?unite_id=<id>&incomplete=1`)
- N écritures **non synchronisées Comptaweb** (cliquable → `/ecritures?unite_id=<id>&status=valide`)

**Section 3 — Répartition par catégorie**
Reprend la table « Par catégorie (comparable au compte de résultat Comptaweb) » de `/synthese`, mais filtrée sur l'unité. Mêmes pastilles d'alerte (catégorie sans `comptaweb_id`, écritures sans catégorie).

**Section 4 — Écritures récentes (50 dernières dans l'exercice filtré)**
- Petite table ou liste : date / description / catégorie / montant signé
- Lien « Voir toutes les écritures (N) » → `/ecritures?unite_id=<id>` (sans filtre exercice ; `/ecritures` ne supporte que `month=YYYY-MM` aujourd'hui, pas l'exercice SGDF)

**Cas non trouvé** : `not-found.tsx` standard Next 16 → message « Cette unité n'existe pas ou n'appartient pas à ton groupe. »

## Décisions de design

- **Identifiant URL = `id` interne** plutôt que `code` : stable, évite les collisions/encodings (codes contiennent parfois `/`, `-`, espaces).
- **Couleur charte SGDF** : utilise `unites.couleur` (déjà rempli par la sync référentiels via `branches-sgdf.ts`). Fallback gris neutre si NULL.
- **Recettes affichées telles quelles** : on n'essaie pas de masquer ou d'ajuster le « 0 € recettes » des unités non-Groupe en phase 1. Pas de tooltip explicatif ajouté ; ce sera traité quand la phase 3 (répartitions) introduira un mécanisme de réallocation.
- **Pas de cache** : toutes les pages restent server components dynamiques (`force-dynamic` hérité de la route group `(app)`). Le coût BDD est négligeable.

## Tests

Tests unitaires à ajouter (vitest, sans BDD) :

- `getUniteOverview` retourne `null` si l'unité n'est pas dans le groupe (anti-énumération).
- `getUniteOverview` agrège correctement les écritures filtrées par `unite_id` + exercice.
- `getUniteOverview` calcule `parCategorie` scopé à l'unité (pas de fuite des autres unités).
- `getUniteOverview` calcule `alertes.depensesSansJustificatif` cohérent avec la version globale.

Tests d'intégration (manuel) :

- Cliquer sur une carte unité → arrive sur la page détail avec le bon ID et exercice préservé.
- Changer d'exercice depuis le détail → URL mise à jour, valeurs recalculées.
- Cliquer sur badge « sans justif » → `/ecritures?unite_id=...&incomplete=1` ouvre la bonne liste.
- Tenter `/synthese/unite/<id-d-un-autre-groupe>` → 404 (pas 403, pas d'info).

## Migration

Aucune migration BDD. Aucun changement de schéma. Phase 1 = pur travail UI + une fonction de service additionnelle.

Le composant `UnitesGrid` remplace l'ancienne table inline dans `synthese/page.tsx` ; c'est un swap d'un block JSX. Les autres sections (cards KPIs globaux, table par catégorie, footer dernier import) restent intactes.

## Suite

Une fois cette phase livrée :

1. **Phase 2 — Budgets prévisionnels par unité** : modéliser les 2 budgets par saison (année + camps), backend `updateBudgetLigne`/`deleteBudgetLigne`, UI d'édition, comparaison prévu vs réel sur les cartes et le détail.
2. **Phase 3 — Répartitions / mouvements internes** : table `repartitions_unites`, UI sur synthèse, intégration au calcul par unité.
