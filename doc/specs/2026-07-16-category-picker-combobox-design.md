# Sélecteur de catégorie — combobox recherchable

**Date :** 2026-07-16
**Statut :** conception validée
**Contexte :** [[project_refonte_vue_ecritures]] (panneau v2 / imputation-grid), composant partagé `CategoryPicker`.

## Problème

La sélection de catégorie se fait via un `<select>` natif déroulant **~50 catégories à plat**, pénible à parcourir (capture terrain 2026-07-16). Le composant partagé `CategoryPicker` (`web/src/components/shared/category-picker.tsx`) a deux modes :
- **chips favoris + select** quand `topIds` est fourni — mais la rangée de chips prend une **ligne verticale de plus** ;
- **`<select>` natif complet** quand `topIds=[]` — c'est le cas du « raccourci orange » (`imputation-grid.tsx:202` passe `topIds={[]}` en dur) → d'où la liste à plat.

L'utilisateur veut mieux, **au minimum pour les catégories**, sans **jamais prendre plus de place que le select actuel** (une ligne), et **dans tous les formulaires** (raccourci orange + formulaire détaillé + wizard + dépôts).

## Objectif

Remplacer le sélecteur de catégorie par un **combobox recherchable** : même encombrement fermé (un déclencheur sur une ligne), recherche au clavier à l'ouverture, favoris en tête. Comme `CategoryPicker` est le composant partagé de tous les formulaires, le retravailler corrige **partout d'un coup**.

Décisions produit validées (2026-07-16) :
- **Fréquentes en tête** de la liste du popover (pas de rangée de chips → zéro encombrement en plus).
- **Filtre par sens** : une écriture de dépense ne propose que les catégories `depense` (+ `les_deux`), une recette que `recette` (+ `les_deux`).

## Approche

### Nouvelle primitive UI `Combobox` (Base UI)

`@base-ui/react/combobox` (v1.4, déjà présent — même lib que `ui/select.tsx`) fournit toutes les parts nécessaires : `Root`, `Input` (recherche), `List`, `Item`, `Group` + `GroupLabel` (sections « Fréquentes » / « Toutes »), `Empty` (aucun résultat), `Popup`, `Positioner`, `Portal`, `Trigger`, `Value`.

Créer `web/src/components/ui/combobox.tsx` : wrapper stylé mince (comme `select.tsx`), pour un **combobox mono-sélection recherchable avec items groupés optionnels**. Style aux tokens existants : surface **opaque** `bg-popover` / `bg-bg-elevated`, `border-border`, ombre `shadow-lg`, `z-50`, popover **porté** (Portal → stacking correct, pas de piège transparence/z-index comme le fix `bg-surface` du 2026-07-15), largeur ancrée au déclencheur, navigation clavier (↑↓/Entrée/Échap), `Empty` « Aucune catégorie trouvée ». Thème clair + sombre.

L'API expose l'essentiel (pas plus — YAGNI) :
```ts
interface ComboboxItem { value: string; label: string; group?: string }
interface ComboboxProps {
  items: ComboboxItem[];          // ordre = ordre d'affichage ; `group` définit les sections
  value: string;                  // valeur courante ('' = aucune)
  onValueChange: (value: string) => void;
  placeholder?: string;           // texte du déclencheur quand value=''
  searchPlaceholder?: string;     // placeholder du champ de recherche
  emptyText?: string;             // libellé quand aucun résultat
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}
```
Le filtrage par frappe est géré par Base UI Combobox (filtre sur `label`). Le groupement suit l'ordre des `items` et leur champ `group`.

### `CategoryPicker` réécrit sur le combobox

Même **API publique** qu'aujourd'hui (compat des call sites), plus un prop `sens` optionnel :
```ts
{
  categories: CategoryOption[];   // { id, name, unmapped?, type }
  topIds: string[];               // favoris (inchangé, déjà calculé serveur)
  name: string;                   // hidden input → FormData (inchangé)
  id?: string;
  defaultValue?: string | null;
  allowEmpty?: boolean;           // défaut true
  emptyLabel?: string;            // défaut 'Aucune'
  disabled?: boolean;
  onChange?: (value: string) => void;
  sens?: 'depense' | 'recette';   // NOUVEAU — filtre par sens (optionnel)
}
```
Rendu :
- **Un `<input type="hidden" name={name} value={value}>`** conservé (compat server actions / FormData — inchangé).
- **Un seul mode** : le combobox (fini la logique à deux modes chips/select). Plus de rangée de chips.
- Construction de la liste d'items passée au `Combobox` :
  1. Option **« — Aucune — »** (si `allowEmpty`), value `''`, sans groupe, toujours en tête.
  2. Groupe **« Fréquentes »** : les catégories de `topIds` (dans l'ordre de `topIds`), présentes après filtre sens.
  3. Groupe **« Toutes »** : le reste, ordre alphabétique (déjà l'ordre de `categories`).
- **Filtre par sens** : si `sens` est fourni, ne garder que les catégories `type === sens || type === 'les_deux'`. **Exception de sûreté** : la catégorie **actuellement sélectionnée** est **toujours présente** même si son type ne matche pas (jamais masquer une valeur déjà posée → pas de perte silencieuse). Si `sens` absent → toutes les catégories (défaut rétro-compatible).
- Décoration `(non sync)` pour `unmapped` conservée.
- `CategoryOption` gagne `type?: 'depense' | 'recette' | 'les_deux'` (pour le filtre). Les call sites passent déjà des `Category` complets ou `{id,name}` — voir migration ci-dessous.

### Câblage dans les formulaires (`sens` + vrais favoris)

- **`imputation-grid.tsx`** : remplacer `topIds={[]}` par les vrais `topCategoryIds` (nouveau prop `topCategoryIds` sur `ImputationGridProps`, threadé depuis le panneau/table qui l'ont déjà) et passer `sens` (nouveau prop, depuis `ecriture.type`).
- **`ecriture-form.tsx`** (formulaire détaillé + wizard `nouveau`) : passer `sens` = type courant du formulaire. Dans le wizard, le type est **basculable** (dépense/recette) → `sens` réactif ; le combobox met à jour sa liste, la valeur sélectionnée reste visible (exception de sûreté).
- **Dépôts** (`depot/`, `depots/`) : gardent `CategoryPicker` avec leurs `topIds` déjà fournis. **`sens` NON passé** au MVP (un dépôt encaisse → recette, mais certaines catégories dépôt/flux pourraient être typées `les_deux`/dépense ; ne pas risquer de masquer la bonne catégorie). Liste complète, mais désormais **recherchable** — déjà un gain net. (Filtrage dépôt = amélioration ultérieure une fois les types des catégories dépôt vérifiés.)

## Ce qui NE change pas

- API publique de `CategoryPicker` (les call sites compilent sans changement, hormis l'ajout optionnel de `sens`/`type`).
- `getTopCategoryIdsForGroup` (calcul serveur des favoris) et son threading.
- Compat FormData (hidden input).
- Les autres sélecteurs (unité ~8 items, activité, mode) restent en `NativeSelect` — listes courtes, pas concernées (l'utilisateur a demandé « au minimum les catégories »). Le combobox reste réutilisable pour elles plus tard.

## Accessibilité / UX

- `role=combobox`, champ de recherche focus à l'ouverture, navigation clavier complète (Base UI).
- Sur mobile : on perd le picker natif OS, mais la recherche sur 50 items est un gain net ; le popover porté reste utilisable au tactile.
- Le déclencheur affiche le libellé sélectionné (ou `emptyLabel`), tronqué proprement (`truncate`), même hauteur/police que `NativeSelect` pour l'homogénéité de la grille.

## Risques / garde-fous

- **Perte de valeur au filtre sens** : neutralisée par l'exception « la valeur sélectionnée est toujours affichée ».
- **Surface transparente** (piège déjà vu 2026-07-15) : imposer une surface **opaque** (`bg-bg-elevated`/`bg-popover`) + `z-50` + Portal ; test visuel dans le panneau (au-dessus du header financier).
- **Régression FormData** : conserver le hidden input ; test qui vérifie que la sélection met bien à jour la valeur soumise.
- **Base UI Combobox** : première utilisation dans le projet → encapsuler dans `ui/combobox.tsx` pour isoler l'API et faciliter un éventuel remplacement.

## Tests

- **`ui/combobox.tsx`** : rend le déclencheur avec le libellé de `value` ; ouvre le popup ; la frappe filtre les items par `label` ; `Empty` s'affiche si aucun match ; sélection d'un item → `onValueChange` ; groupes rendus dans l'ordre avec leurs `GroupLabel` ; clavier (Entrée sélectionne l'item actif).
- **`CategoryPicker`** :
  - « Fréquentes » listées avant « Toutes » ; une catégorie favorite n'apparaît pas en double dans « Toutes ».
  - Filtre sens : avec `sens='depense'`, une catégorie `recette` pure est absente ; une `les_deux` est présente ; **la catégorie sélectionnée d'un autre sens reste affichée**.
  - `allowEmpty` : option « — Aucune — » présente et sélectionnable → valeur `''`.
  - Hidden input `name` : sa `value` reflète la sélection (compat FormData) ; `onChange` appelé.
  - `unmapped` → suffixe « (non sync) ».
  - `topIds=[]` + `sens` absent (cas raccourci orange historique) : liste complète recherchable, pas de crash.
- **Non-régression** : les tests existants de `imputation-grid`, `ecriture-form`, panneau, dépôts restent verts (adapter les assertions qui ciblaient le `<select>`/chips).
