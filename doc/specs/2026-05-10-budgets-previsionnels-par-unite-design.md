# Spec — Budgets prévisionnels par unité (phase 2)

**Date** : 2026-05-10
**Statut** : design validé, prêt à plan d'impl
**Phase** : 2 (suite de la phase 1 « vue par unité » mergée dans #9)

---

## Contexte

La phase 1 a livré une grille de cartes par unité sur `/synthese` et une page détail `/synthese/unite/[id]` qui affichent le **réel**. Il manque le **prévisionnel** pour piloter : « combien j'ai prévu pour les Louveteaux ? combien j'ai déjà consommé ? »

Côté BDD, les tables `budgets` (1 par saison) et `budget_lignes` (libellé, type, montant, unité, catégorie) existent déjà depuis le MVP, mais aucune UI ni aucune logique de comparaison ne les exploite.

## Objectifs

1. Permettre au trésorier de **saisir et éditer** des lignes budget prévisionnelles par saison, par unité, par activité.
2. Afficher **prévu vs réel** sur les cartes de `/synthese` (barre de progression) et sur le détail unité (colonne « Budget » + bloc « Par activité »).
3. Compléter le backend manquant : `updateBudgetLigne`, `deleteBudgetLigne`, API REST associée.

## Décisions structurantes

### 1. Dualité « activités d'année » vs « camps d'été » → dérivée des activités, pas d'une dimension dédiée

Le groupe gère deux types de budgets : activités d'année (sept→juin/juillet) et camps d'été (juillet/août). **On n'ajoute pas de dimension `periode` séparée.** Chaque écriture porte déjà un `activite_id` (référence Comptaweb), et chaque activité est intrinsèquement « un camp » ou « une activité d'année » (visible dans son nom). La dualité année/camps reste implicite dans le référentiel des activités.

→ Ajout BDD minimal : **`budget_lignes.activite_id`** (nullable, FK `activites.id`).

### 2. 1 budget par saison (statut commun)

On garde l'existant : `UNIQUE(group_id, saison)`. Si un jour le besoin de votes séparés année vs camps émerge, on évoluera (table `budget_periodes` ou champ `statut_camps`). Pour l'instant, le statut (`projet`/`vote`/`cloture`) reste global au niveau saison.

### 3. Réconciliation prévu vs réel = par activité ET par unité

Les calculs reposent sur l'égalité `budget_lignes.activite_id = ecritures.activite_id` ET `budget_lignes.unite_id = ecritures.unite_id`. Pas d'agrégation par catégorie en comparaison (on affiche la catégorie pour info, mais on ne réconcilie pas dessus — trop fragile).

### 4. Caisse hors scope synthèse (clarification)

La synthèse compte les `ecritures` uniquement (incluant les paiements espèces via `mode_paiement = especes`). Les `mouvements_caisse` sont la traçabilité interne de la caisse physique, contrepartie d'écritures déjà comptées. **Pas de changement nécessaire en phase 2.** Si un `mouvement_caisse` orphelin (sans écriture liée) est détecté, c'est une anomalie à corriger côté Comptaweb, pas à intégrer dans les totaux Baloo.

## Hors scope (phase 2)

- Mécanisme de **répartition entre unités** (table `repartitions_unites`) — viendra en phase 3.
- Vote séparé annee/camps (statuts indépendants) — différé.
- Compteur « Mouvements caisse sans écriture liée » — autre chantier si besoin émerge.
- Templates / duplication budget saison précédente — possible jalon 2, ne bloque pas phase 2.
- Lecture seule sur budget `cloture` → on l'implémente (warning + désactivation des actions), c'est court.

## Architecture

### Modèle BDD

```sql
ALTER TABLE budget_lignes ADD COLUMN activite_id TEXT REFERENCES activites(id);
CREATE INDEX IF NOT EXISTS idx_budget_lignes_activite ON budget_lignes(activite_id);
```

Aucun backfill nécessaire (les lignes existantes restent avec `activite_id = NULL`, ce qui les classe en « Sans activité »).

### Backend service (`web/src/lib/services/budgets.ts`)

Compléter :

```ts
// Patch partiel. Garde anti-énumération via JOIN sur budgets.
export async function updateBudgetLigne(
  ctx: BudgetContext,
  ligneId: string,
  patch: Partial<{
    libelle: string;
    type: BudgetLigneType;
    amount_cents: number;
    unite_id: string | null;
    category_id: string | null;
    activite_id: string | null;
    notes: string | null;
  }>,
): Promise<BudgetLigne | null>;

// DELETE direct — le prévisionnel n'est pas concerné par la doctrine "jamais
// de DELETE" (qui vise les écritures, justifs, rembs, etc.). Une ligne
// budget supprimée par erreur peut être re-saisie sans coût.
export async function deleteBudgetLigne(
  ctx: BudgetContext,
  ligneId: string,
): Promise<boolean>;
```

Une nouvelle fonction d'agrégation pour la comparaison :

```ts
// Renvoie, pour une saison donnée, la somme prévue par unité (toutes
// activités confondues) et par (unité, activité). Pas de filtre exercice
// car le budget est lié à une saison, pas à un exercice SGDF (le budget
// d'une saison court grosso modo sur 1 exercice SGDF).
export interface BudgetParUnite {
  unite_id: string;
  prevu_depenses_cents: number;
  prevu_recettes_cents: number;
}
export interface BudgetParUniteActivite {
  unite_id: string;
  activite_id: string | null;
  activite_name: string | null;
  prevu_depenses_cents: number;
  prevu_recettes_cents: number;
}
export async function getBudgetPrevuParUnite(
  ctx: BudgetContext,
  saison: string,
): Promise<{
  parUnite: BudgetParUnite[];
  parUniteActivite: BudgetParUniteActivite[];
}>;
```

### API REST (`web/src/app/api/budgets/[id]/lignes/[ligneId]/route.ts`)

Nouvelles routes :

- `PATCH /api/budgets/[id]/lignes/[ligneId]` — patch partiel, body validé via zod.
- `DELETE /api/budgets/[id]/lignes/[ligneId]` — suppression simple.

Anti-énumération : la fonction service vérifie `budget.group_id = ctx.groupId` via JOIN avant tout patch/delete ; retourne `null` / `false` sinon, route répond `404`.

### UI

#### Page `/budgets` (nouvelle)

- **Header** : `PageHeader` « Budget », sélecteur saison (défaut = saison courante SGDF, options 4 dernières + saison à venir), statut éditable (projet/voté/clôturé).
- **Totaux du budget** : 3 stat cards Prévu dépenses / Prévu recettes / Prévu solde.
- **Tableau de lignes éditables inline** :
  - Colonnes : libellé, type (dépense/recette), montant, unité, catégorie, activité, notes, action (✕)
  - Ligne d'ajout en bas (« + nouvelle ligne »)
  - Édition inline via composants existants (`<NativeSelect>`, `<Input>`)
  - Sauvegarde via Server Actions (cohérent avec le reste du projet, cf. `lib/actions/`)
- **Lecture seule** si `statut = 'cloture'` : champs grisés, actions désactivées, banner explicatif.
- **Pas de groupement année/camps** dans l'UI — l'utilisateur filtre ou cherche par activité s'il veut isoler les camps.
- **Vide** : si aucune ligne sur la saison sélectionnée, message « Pas encore de budget pour cette saison » + bouton « Créer le budget » qui appelle `createBudget` puis affiche le formulaire d'ajout.

#### Intégration `/synthese`

Sur chaque `UniteCard` :
- Nouvelle ligne « Budget » avec montant prévu (dépenses) sur la saison courante
- **Barre de progression** : consommé (réel dépenses) / prévu — couleur charte SGDF de l'unité, rouge si > 100%
- Cliquer sur la carte ouvre toujours `/synthese/unite/[id]` (inchangé)

#### Intégration `/synthese/unite/[id]`

- **Sur la table « Par catégorie »** : nouvelle colonne « Budget » (somme prévue par catégorie, scopée à l'unité, exercice ignoré côté budget). Si une catégorie a du réel sans prévu, on affiche `—` ; si elle a du prévu sans réel, on l'affiche quand même.
- **Nouveau bloc « Par activité »** sous « Par catégorie » :
  - Table : activité, prévu dépenses, prévu recettes, réel dépenses, réel recettes, écart (réel - prévu, signed)
  - Lignes triées par prévu décroissant
  - « Sans activité » en dernière ligne si applicable

### Saison vs exercice SGDF

Le projet utilise l'**exercice SGDF** (Sept→Août) côté synthèse, désigné comme `'YYYY-YYYY+1'` (ex. `'2025-2026'`). Les budgets utilisent la même convention (`budgets.saison`). On considère que 1 saison budget ≈ 1 exercice SGDF (la phase 1 a établi cette convention).

→ Le filtre exercice sur `/synthese` se traduit naturellement en saison sur `/budgets`. La carte unité montre le prévu de la **saison correspondant à l'exercice filtré** (mapping 1-1).

## Composants à créer

```
web/src/app/(app)/budgets/page.tsx                    ← NEW : page principale
web/src/app/(app)/budgets/budget-form.tsx             ← NEW (client component) : tableau de lignes éditable
web/src/app/api/budgets/[id]/lignes/[ligneId]/route.ts ← NEW : PATCH + DELETE

web/src/lib/services/budgets.ts                        ← MODIFIÉ : add updateBudgetLigne, deleteBudgetLigne, getBudgetPrevuParUnite + activite_id sur create/update
web/src/lib/actions/budgets.ts                         ← NEW : server actions inline (createLigne, updateLigne, deleteLigne, updateBudgetStatut)
web/src/lib/db/business-schema.ts                      ← MODIFIÉ : doc-only (la colonne activite_id sera ajoutée via auth/schema.ts ALTER pour rester safe sur la BDD prod)
web/src/lib/auth/schema.ts                             ← MODIFIÉ : ALTER TABLE budget_lignes ADD COLUMN activite_id + CREATE INDEX

web/src/components/synthese/unite-card.tsx             ← MODIFIÉ : ajoute prop optionnelle `budget` { prevu_cents }, affiche barre de progression
web/src/lib/services/overview.ts                       ← MODIFIÉ : jointure / sous-query pour ajouter `budgetPrevuDepenses` à parUnite ET à UniteOverviewData
web/src/app/(app)/synthese/unite/[id]/page.tsx         ← MODIFIÉ : ajoute colonne Budget sur la table catégorie, bloc Par activité
```

## Tests

Pattern projet : tests unitaires sur fonctions pures uniquement (cf. phase 1). Pas de tests BDD-coupled.

Cas à vérifier manuellement :
- Création/édition/suppression de lignes budget
- Anti-énumération : passer un `id` budget d'un autre groupe → 404
- Saisie d'une ligne sans activité → apparaît dans la section/groupement « Sans activité »
- Carte unité : barre de progression à 0%, 50%, 100%, >100% (couleur rouge)
- Détail unité : colonne Budget cohérente avec la saisie ; bloc Par activité affiche les bons couples (unité × activité)
- Statut `cloture` : édition désactivée, message visible

## Migrations

1. Ajouter `ALTER TABLE budget_lignes ADD COLUMN activite_id TEXT` dans `lib/auth/schema.ts` (qui tourne après `business-schema.ts`, cf. convention projet pour éviter les CREATE INDEX cassés).
2. Ajouter `CREATE INDEX IF NOT EXISTS idx_budget_lignes_activite ON budget_lignes(activite_id)` au même endroit, après l'ALTER.
3. Aucun backfill — les lignes existantes (probablement aucune en prod) restent NULL.

## Risques et points d'attention

- **Index sur `budget_lignes(activite_id)`** : à créer après l'ALTER (cf. piège documenté dans `web/AGENTS.md`).
- **Server actions vs API REST** : on garde l'API REST pour l'usage MCP (Claude Code → API token), et on ajoute des server actions pour l'UI (cohérent avec `lib/actions/ecritures.ts` etc.). Pas de duplication de logique : les server actions appellent les fonctions service.
- **Performance** : la sous-requête budget sur `getOverview` ajoute un SELECT par exécution. Acceptable (n_unites ~ 5-10).
- **Réconciliation `prévu vs réel`** : si l'utilisateur ne saisit pas d'`activite_id` sur ses lignes budget, le bloc « Par activité » sur la page détail reste utilisable (lignes en « Sans activité »), mais la comparaison perd en granularité.

## Suite (phase 3)

- **Répartitions / mouvements internes entre unités** (`repartitions_unites`) : permettra de réallouer les recettes d'inscriptions (encaissées globalement) vers les unités. Une fois en place, les soldes par unité prendront en compte ces flux, ce qui rendra la vue « solde par unité » fiable.
