# Import des écritures hors-résultat (transferts inter-structures) dans le miroir

**Date** : 2026-07-03
**Statut** : design validé (en attente relecture)

## Cap directeur

**La liste des écritures validées de Baloo doit être le miroir exact de la liste des écritures de Comptaweb.** Aujourd'hui ce n'est pas vrai pour une famille d'écritures : les transferts inter-structures.

## Problème (cas concret 2026-07-02)

Les trésoriers du territoire saisissent dans Comptaweb une écriture « Regroupement de 2 prélèvements nationaux du 01/06/2026 » (-159 €, mode **Virement**, tiers **Echelon National**, sans n° pièce). Elle correspond à un mouvement bancaire réel (PRLV SEPA -159 € du 03/06).

Dans Baloo : **cette écriture est absente de la liste validée** (`comptaweb_ecriture_id 2403659` → 0 résultat, même après sync forcée `imported_from_cw: 0`). Seul subsiste un **draft** généré depuis la ligne bancaire (`ECR-2026-368`), que l'utilisateur ne peut pas valider sans créer un doublon dans CW.

Le vrai bug = **l'absence de la ligne dans le validé**. Le draft en doublon est secondaire.

Ce n'est pas isolé : la liste CW en contient déjà un second (2427230, -962 € du 01/07). C'est **récurrent chaque mois**.

## Cause racine

La sync miroir lit le **journal `/recettedepense`** (compte de résultat : charges/produits). Un transfert vers l'échelon national **n'est pas une charge du groupe** (on collecte des adhésions et on les reverse) : c'est un **flux inter-structures hors résultat**. Comptaweb ne le met donc **pas** dans `/recettedepense` — il n'apparaît que dans l'écran de **rapprochement bancaire** (`ecritures_comptables_non_rapprochees`). Baloo ne le voit jamais.

Preuve discriminante : l'autre écriture non rapprochée de la liste (2303515 « hébergement weekend SCC », un chèque ordinaire) **est** dans Baloo (`ECR-2026-358`, mirror) car elle, est bien dans `/recettedepense`.

## Ce qui existe déjà et qu'on réutilise (→ aucune migration)

1. **`listRapprochementBancaire`** renvoie déjà `ecrituresComptables` (les non rapprochées, dont ces transferts), avec `montant`, `date`, `type`, `intitulé`, `mode`, **`tiers`**. Donnée en main, pas de nouveau scrape.
2. **`CATEGORIES_HORS_RESULTAT`** (`overview.ts:23`) = `['cat-depot-especes', 'cat-flux-structures']`. Une écriture avec `category_id = 'cat-flux-structures'` est **exclue du résultat et des budgets** (overview + camps) mais **comptée dans la trésorerie** (l'argent est bien sorti). C'est exactement le comportement voulu pour un transfert.
3. Le mirror des écritures de journal pose `description = intitulé` CW. On applique le même principe ici : l'écriture promue/créée **adopte le titre CW** (souvent plus parlant que le libellé bancaire) — demande explicite de l'utilisateur.

**Important — pas de scrape détail pour ces écritures.** `processCwEcriture` (le chemin d'import du journal) lit la page détail `/recettedepense/<id>/afficher` pour la ventilation. Ces transferts **ne sont pas dans ce journal** : leur page détail peut ne pas exister. On ne passe donc **pas** par `processCwEcriture` ; on construit le mirror **directement depuis la ligne du rapprochement** (une seule « ventilation » = la ligne elle-même), sans scrape détail.

## Design

### Nouvelle source d'import : les transferts du rapprochement

Dans le cycle de sync, en plus du journal `/recettedepense`, on traite les `ecrituresComptables` du rapprochement **filtrées sur les flux inter-structures** : `tiers == 'Echelon National'` (discriminant du hors-résultat ; on ne touche pas aux autres non-rapprochées comptables, qui relèvent du journal).

Pour chaque écriture CW `C` ainsi retenue :

1. **Déjà mirrorée ?** S'il existe une écriture Baloo **non-draft** (mirror / pending / divergent / validée) matchant `C` par **contenu** (`amount_cents` + `type` + date à ±`DRAFT_DATE_TOLERANCE_DAYS`) → **skip** (évite le doublon avec le journal ; l'id du rapprochement ≠ l'id du journal, donc dédup par contenu, pas par id).
2. **Draft à promouvoir ?** Sinon, s'il existe **exactement un** draft matchant `C` par contenu → **promotion en ligne validée** : `comptaweb_ecriture_id = C.id`, `status = 'mirror'`, `comptaweb_synced = 1`, `description = C.intitulé`, `category_id = 'cat-flux-structures'`. Le draft **devient** la ligne validée (plus de draft résiduel).
3. **Sinon** → **création** d'un mirror depuis `C` (description = intitulé, montant, type, `category_id = 'cat-flux-structures'`, `status = 'mirror'`, `comptaweb_synced = 1`, `comptaweb_ecriture_id = C.id`).

Unicité exigée au point 2 (un seul draft candidat), à l'image de la garde du `reconcile` existant, pour éviter une promotion ambiguë.

### Garde-fou : ne pas faussement « supprimer » ces écritures

La détection `supprimee_cw` du `reconcile` (`ecritures-sync-reconcile.ts`) marque supprimée toute écriture reliée dont le `comptaweb_ecriture_id` tombe dans la plage `[minId,maxId]` du snapshot `/recettedepense` mais en est absente. Une écriture hors-résultat importée ici (absente de `/recettedepense` **par nature**) serait faussement marquée supprimée à la sync suivante.

**Correctif** : exclure de la détection de suppression les écritures **hors résultat** (`category_id ∈ CATEGORIES_HORS_RESULTAT`). Elles ne sont jamais dans le journal, donc jamais légitimement « disparues du journal ». Concrètement : `loadBalooRows` expose le `category_id` (ou un booléen `horsResultat`), et la branche `deletions` du `reconcile` saute ces lignes.

### Hors périmètre V1 (limites assumées)

- **Le rapprochement bancaire dans Comptaweb** (cocher les deux lignes dans l'écran CW) reste **manuel** — l'utilisateur le gère (version future). Baloo reflète juste l'écriture comme validée.
- **Les transferts déjà rapprochés côté CW** ne sont plus dans la liste des non-rapprochées **ni** dans `/recettedepense` : Baloo ne peut pas les voir avec les scrapes actuels. Une fois importés ici ils restent en base (le garde-fou empêche leur suppression), mais un transfert historique jamais passé par Baloo ne remontera pas. Couvrir ça demanderait un journal CW dédié (reverse-engineering) → pas V1.

## Où ça vit

- `sync-cycle.ts` : nouvelle passe « import transferts rapprochement », **indépendante de `processCwEcriture`** (create/promote direct depuis la ligne du rapprochement, sans scrape détail). Compteur dédié (ex. `imported_hors_resultat`) dans le résultat de sync.
- `ecritures-sync-reconcile.ts` : garde-fou `deletions` (exclusion hors-résultat).
- Réutilise `cat-flux-structures` (vérifier son existence en base ; c'est un référentiel national attendu par `CATEGORIES_HORS_RESULTAT`).

## Tests (TDD)

1. **Promotion** : draft matchant un transfert CW → devient mirror, `description = intitulé CW`, `category = cat-flux-structures`, plus aucun draft.
2. **Création** : transfert CW sans draft → mirror créé depuis la ligne CW.
3. **Dédup** : transfert déjà présent en Baloo (par contenu) → pas de ré-import (cas « hébergement »).
4. **Filtre** : une non-rapprochée comptable ordinaire (`tiers ≠ 'Echelon National'`) n'est pas importée par cette passe.
5. **Anti-faux-positif suppression** : après import, un `reconcile` sur un snapshot `/recettedepense` (sans ce transfert) ne marque **pas** l'écriture `supprimee_cw`.
6. **Hors résultat** : l'écriture importée est exclue du calcul de résultat (overview) mais présente en trésorerie.

## Migration

**Aucune colonne nouvelle.** On réutilise `category_id = 'cat-flux-structures'` comme marqueur (hors-résultat + exclusion suppression).
