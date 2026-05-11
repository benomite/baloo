# Spec — Répartitions entre unités (phase 3)

**Date** : 2026-05-11
**Statut** : design validé, prêt à plan d'impl
**Phase** : 3 (clôt le chantier « budgets par unité » initié en phase 1)

---

## Contexte

Les phases 1 et 2 ont livré la vue **par unité** (grille de cartes couleur SGDF, page détail, barre de progression budget). Reste le problème de fond : **les recettes d'inscriptions sont encaissées globalement** (catégorie « Cotisations », `unite_id = NULL` ou « Groupe »). Conséquence : les cartes Farfadets / LJ / SG / PC / CO affichent 0€ de recettes alors que ces unités ont bien une enveloppe alimentée par les inscriptions.

Demander au trésorier de re-ventiler les ~30 écritures d'inscription côté Comptaweb (ce qui est techniquement possible via les ventilations Comptaweb natives, cf. spec phase 1) est trop coûteux à la main. La doctrine retenue : créer un **mouvement de réallocation interne Baloo-only** qui déplace X€ de « Groupe » vers une unité (ou entre unités), sans flux Comptaweb. Une seule entrée logique = « -1200€ Groupe / +1200€ LJ ».

## Objectifs

1. Permettre la saisie et la suppression de **répartitions** entre unités (modale + liste).
2. Refléter ces répartitions dans la **vue par unité** de `/synthese` et `/synthese/unite/[id]`.
3. Garder la doctrine « Comptaweb = source de vérité comptable ». Les répartitions ne quittent pas Baloo.

## Vocabulaire

**Répartition** (verbe « répartir ») = mouvement interne d'une unité source vers une unité cible, montant positif. NULL côté source ou cible = « Groupe » (pot commun). Le terme « transfert interne » est **interdit** côté code/UI car il désigne déjà les dépôts caisse → banque (cf. `cleanup-transferts.ts`).

## Architecture

### Modèle BDD

Nouvelle table :

```sql
CREATE TABLE IF NOT EXISTS repartitions_unites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groupes(id),
  date_repartition TEXT NOT NULL,
  saison TEXT NOT NULL,
  montant_cents INTEGER NOT NULL CHECK(montant_cents > 0),
  unite_source_id TEXT REFERENCES unites(id),
  unite_cible_id TEXT REFERENCES unites(id),
  libelle TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK(unite_source_id IS NOT DISTINCT FROM unite_cible_id IS NOT 1)
);
CREATE INDEX IF NOT EXISTS idx_repartitions_group_saison ON repartitions_unites(group_id, saison);
CREATE INDEX IF NOT EXISTS idx_repartitions_source ON repartitions_unites(unite_source_id);
CREATE INDEX IF NOT EXISTS idx_repartitions_cible ON repartitions_unites(unite_cible_id);
```

⚠️ Le `CHECK (source != cible)` ne s'exprime pas trivialement en SQLite quand l'une des valeurs peut être NULL. Mitigation : valider côté code (server action / service) que `unite_source_id` et `unite_cible_id` ne sont pas tous les deux NULL (réalloc Groupe → Groupe = no-op) et qu'ils ne sont pas égaux (réalloc LJ → LJ = no-op). Le `CHECK` SQL sera retiré de la spec (cf. convention projet « validation workflow en code, pas en BDD », ADR-019).

Schéma final retenu (sans CHECK SQL) :

```sql
CREATE TABLE IF NOT EXISTS repartitions_unites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groupes(id),
  date_repartition TEXT NOT NULL,
  saison TEXT NOT NULL,
  montant_cents INTEGER NOT NULL,
  unite_source_id TEXT REFERENCES unites(id),
  unite_cible_id TEXT REFERENCES unites(id),
  libelle TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_repartitions_group_saison ON repartitions_unites(group_id, saison);
CREATE INDEX IF NOT EXISTS idx_repartitions_source ON repartitions_unites(unite_source_id);
CREATE INDEX IF NOT EXISTS idx_repartitions_cible ON repartitions_unites(unite_cible_id);
```

Migration : la table est nouvelle, donc `CREATE TABLE IF NOT EXISTS` dans `business-schema.ts` suffit pour BDD vierges + ALTER inutile pour BDD prod (le `IF NOT EXISTS` la crée si absente). Pas de bloc dans `auth/schema.ts`.

### Service (`web/src/lib/services/repartitions.ts` — nouveau fichier)

```ts
export interface RepartitionContext { groupId: string }

export interface Repartition {
  id: string;
  group_id: string;
  date_repartition: string;     // YYYY-MM-DD
  saison: string;                // 'YYYY-YYYY+1'
  montant_cents: number;
  unite_source_id: string | null;
  unite_cible_id: string | null;
  libelle: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRepartitionInput {
  date_repartition: string;
  saison: string;
  montant_cents: number;
  unite_source_id: string | null;
  unite_cible_id: string | null;
  libelle: string;
  notes?: string | null;
}

export type UpdateRepartitionInput = Partial<{
  date_repartition: string;
  saison: string;
  montant_cents: number;
  libelle: string;
  notes: string | null;
}>;
// NOTE : pas de unite_source_id / unite_cible_id dans update — pour changer
// la source ou la cible, supprimer et recréer (cohérence sémantique).

// Fonctions exportées :
listRepartitions(ctx, { saison? }) : Repartition[]
listRepartitionsByUnite(ctx, { saison }) : Map<unite_id, { entrantes, sortantes, net }>
createRepartition(ctx, input) : Repartition  // valide source != cible, montant > 0
updateRepartition(ctx, id, patch) : Repartition | null  // anti-énumération via group_id
deleteRepartition(ctx, id) : boolean
getRepartitionsNetByUnite(ctx, saison) : { [unite_id: string]: number }  // pour synthese
```

**Validation en code** (pas en BDD) :
- `montant_cents > 0` — sinon erreur côté server action (retourne FormState avec message)
- `unite_source_id !== unite_cible_id` — sinon erreur (même les deux NULL est interdit)

**Anti-énumération** : toutes les fonctions filtrent par `group_id = ?` ; les `update` / `delete` retournent `null` / `false` si la répartition n'appartient pas au groupe.

### Server actions (`web/src/lib/actions/repartitions.ts`)

```ts
'use server';

createRepartitionAction(formData): void  // revalidatePath('/synthese')
updateRepartitionAction(formData): void
deleteRepartitionAction(formData): void
```

Pattern identique à `actions/budgets.ts` (admin guard, zod, `nullIfEmpty`, `parseAmount`).

### API REST (out of scope phase 3)

Les server actions suffisent. Pas d'API REST en phase 3 — on en ajoutera si un consommateur externe (MCP, script) en a besoin.

### Intégration calcul `getOverview` et `getUniteOverview`

Sur `web/src/lib/services/overview.ts` :

**`getOverview.parUnite`** — étendre avec :
```ts
parUnite: {
  // …champs existants : id, code, name, couleur, depenses, recettes, solde, budget_prevu_depenses
  realloc_net_cents: number;        // entrantes - sortantes pour l'unité, sur la saison/exercice filtré
  solde_avec_realloc: number;       // recettes - depenses + realloc_net_cents
}[];
```

Sous-requête SQL ajoutée à la query `parUniteRows`, restreinte aux répartitions de la saison correspondant à l'exercice filtré :

```sql
COALESCE((
  SELECT
    COALESCE(SUM(CASE WHEN r.unite_cible_id = u.id THEN r.montant_cents ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN r.unite_source_id = u.id THEN r.montant_cents ELSE 0 END), 0)
  FROM repartitions_unites r
  WHERE r.group_id = ? AND r.saison = ?
), 0) as realloc_net_cents
```

`solde_avec_realloc = recettes - depenses + realloc_net_cents` (mappé côté JS dans le `return`).

**`getUniteOverview`** — étendre avec :
```ts
interface UniteOverviewData {
  // …existant
  reallocNetCents: number;        // entrantes - sortantes pour cette unité
  reallocEntrantesCents: number;  // entrantes seulement
  reallocSortantesCents: number;  // sortantes seulement
  repartitions: Repartition[];    // liste pour le bloc « Répartitions de la saison »
}
```

Le KPI `Solde` de la page détail devient `recettes + realloc_net - depenses` (mais nommé clairement, voir UI).

### UI

#### `/synthese` — section « Par unité »

- **Bouton « Répartir »** au-dessus de la grille (à côté du titre de la section), accessible aux rôles `tresorier` / `RG` uniquement. Ouvre une modale.
- **`UniteCard`** : ajouter une ligne « Réalloc » (signed, format `+1200,00 €` ou `-600,00 €`) **uniquement si `realloc_net_cents !== 0`**. Le `Solde` affiché devient `solde_avec_realloc`.

**Modale « Répartir »** (client component, dialog) :
- Date (default = aujourd'hui, format YYYY-MM-DD)
- Source (`NativeSelect` : « Groupe » + liste unités du groupe)
- Cible (`NativeSelect` : « Groupe » + liste unités du groupe)
- Montant (Input format français)
- Libellé (Input texte court, required)
- Notes (Input texte long, optional)
- Boutons « Annuler » / « Créer »
- Validation client : source ≠ cible, montant > 0

Soumission via la server action `createRepartitionAction`. Si erreur de validation, message renvoyé via `useFormState`.

#### `/synthese/unite/[id]` — nouveaux blocs

**Nouveau KPI** dans le bloc des 3 stat cards : remplacer par 4 cards si `reallocNetCents !== 0`, sinon garder 3.
- Dépenses (négatif)
- Recettes (positif)
- **Réalloc** (signed, affiché seulement si `!== 0`)
- Solde (signed) — = `recettes + reallocNetCents - depenses`

**Nouveau bloc « Répartitions de la saison »** sous « Par activité », au-dessus de « Écritures récentes » :
- Table : date / source / cible / libellé / montant / ✕
- Lignes triées par date desc
- Si la répartition pointe vers/depuis l'unité courante, on l'affiche en gras (l'autre direction est en muted)
- Edit inline sur libellé / montant / notes / date (pas source/cible)
- Bouton supprimer (✕) appelle `deleteRepartitionAction`
- Empty state : « Aucune répartition sur cette saison »
- Bouton « + Répartir vers/depuis cette unité » qui ouvre la même modale que la grille, mais pré-rempli avec l'unité courante en cible

### Saison & filtre exercice

Les répartitions sont filtrées par **saison** (chaîne `'YYYY-YYYY+1'` cohérente avec les budgets, cf. phase 2). Sur `/synthese`, le filtre exercice se traduit en saison (mapping 1-1, cf. spec phase 2).

Si le filtre exercice est « Tous » (`exercice=tous` sur `/synthese`), les répartitions sont **agrégées toutes saisons confondues** pour la vue par unité — la doctrine reste « la vue « Tous » montre tout, sans filtre ».

## Hors scope (phase 3)

- **API REST** sur `repartitions_unites` — pas de consommateur externe identifié. À ajouter plus tard si besoin (MCP, scripts).
- **Templates / duplication** d'une répartition d'une saison à l'autre — pas demandé.
- **Multi-source / multi-cible** dans une seule entrée (ex. une recette globale ventilée en N filles via une UI dédiée) — utile mais peut attendre, on ouvre la modale N fois pour l'instant.
- **Activité sur une répartition** — pas demandé (les répartitions ne sont pas liées à une activité, contrairement aux budgets/écritures).
- **Catégorie sur une répartition** — idem.
- **Effet sur la barre de progression budget** (`UniteCard.budget_prevu_depenses`) — inchangé. Le budget compare prévu vs dépenses réelles. Les répartitions augmentent les recettes nettes, pas les dépenses.

## Schéma de données complet du calcul par unité

Après phase 3, pour une unité U et un exercice E :

```
depenses(U, E)            = SUM(ecritures.amount_cents WHERE unite=U AND type=depense AND date∈E)
recettes(U, E)            = SUM(ecritures.amount_cents WHERE unite=U AND type=recette AND date∈E)
realloc_entrantes(U, E)   = SUM(repartitions.montant_cents WHERE unite_cible=U AND saison=E)
realloc_sortantes(U, E)   = SUM(repartitions.montant_cents WHERE unite_source=U AND saison=E)
realloc_net(U, E)         = realloc_entrantes - realloc_sortantes
solde_net(U, E)           = recettes - depenses + realloc_net
```

Solde groupe global (toutes unités) inchangé : la somme des réallocs est par construction nulle (chaque montant entrant a son montant sortant). Vérifiable en intégration.

## Permissions

`tresorier` et `RG` uniquement (cohérent avec budgets/synthese). Pattern :
- `assertAdmin()` dans toutes les server actions
- Le bouton « Répartir » et le bouton supprimer ne s'affichent pas pour les autres rôles
- Le calcul `realloc_net` reste visible pour les chefs scopés (lecture seule)

## Tests

Pattern projet : pas de tests unitaires sur services BDD-coupled. Fonction pure isolable et testable : valider une `CreateRepartitionInput` (source ≠ cible, montant > 0, dates valides, saison cohérente avec date). Cette fonction de validation peut vivre dans un module pur testable.

**Test unitaire (vitest, sans BDD)** — `web/src/lib/services/repartitions-validation.test.ts` :
- `source = cible` → erreur
- `source NULL et cible NULL` → erreur (Groupe → Groupe = no-op)
- `montant_cents <= 0` → erreur
- `montant_cents > 0` + `source !== cible` → ok
- saison ne matche pas l'année de `date_repartition` → warning (mais accepté ; l'utilisateur peut vouloir saisir une réalloc rétroactive)

**Vérifications manuelles** (cf. plan d'impl) :
- Bilan total inchangé après une répartition (somme groupe = inchangée)
- Cartes synthese reflètent les bons montants nets
- Anti-énumération : impossible de modifier une réalloc d'un autre groupe

## Composants à créer

```
web/src/lib/db/business-schema.ts                 ← MODIFIÉ : ajout CREATE TABLE repartitions_unites
web/src/lib/services/repartitions.ts              ← NEW : service complet
web/src/lib/services/repartitions-validation.ts   ← NEW : fonction pure testable
web/src/lib/services/repartitions-validation.test.ts ← NEW : tests vitest purs
web/src/lib/actions/repartitions.ts               ← NEW : server actions
web/src/lib/queries/repartitions.ts               ← NEW : wrappers avec resolveContext

web/src/lib/services/overview.ts                  ← MODIFIÉ : sous-requête realloc dans parUnite + getUniteOverview
web/src/components/synthese/unite-card.tsx        ← MODIFIÉ : ajoute ligne « Réalloc » + ajuste affichage Solde
web/src/app/(app)/synthese/page.tsx               ← MODIFIÉ : passe realloc à UnitesGrid, ajoute bouton « Répartir »
web/src/app/(app)/synthese/unite/[id]/page.tsx    ← MODIFIÉ : KPI Réalloc + bloc « Répartitions de la saison »
web/src/components/synthese/repartition-modal.tsx ← NEW (client) : modale de saisie
web/src/components/synthese/repartitions-list.tsx ← NEW (client) : table éditable des répartitions
```

## Suite

Le chantier « budgets par unité » est complet après cette phase. Évolutions futures possibles (ne sont **pas** dans la roadmap immédiate) :

- **Multi-ventilation dans une seule modale** : encoder en une opération « 3000€ Groupe → {Farfa: 600, LJ: 1200, SG: 1200} » qui crée N répartitions en bloc.
- **Suggestion automatique** depuis les effectifs : « N inscrits LJ × tarif → quote-part LJ ». Nécessite les effectifs en base.
- **Synchronisation Comptaweb** : créer des ventilations Comptaweb équivalentes via `cw_create_recette` pour aligner le compte de résultat officiel sur la vue Baloo.
- **Sync inverse** : import du compte de résultat Comptaweb ventilé pour valider l'allocation.
