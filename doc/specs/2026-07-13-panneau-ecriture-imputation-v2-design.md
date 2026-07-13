# Panneau d'écriture v2 — imputation resserrée & ventilation en place

**Date** : 2026-07-13
**Statut** : design validé (maquette approuvée), prêt pour plan
**Dépend de** : sous-projet #20 « ventiler un draft existant » (`2026-07-13-ventilation-draft-existant-design.md`) — réutilise `ventilateDraft`, `PUT /api/ecritures/[id]/ventilations`, et les helpers `editorRemainderCents` / `isMultiCategory`.
**Suit** : `2026-07-04-refonte-panneau-ecriture-design.md` (panneau inline unique, modes edit-bank / edit-manual / readonly).

## Problème

Le panneau déplié actuel :
- **répète** le titre, la date et le montant déjà présents dans le bandeau juste au-dessus ;
- présente l'imputation comme un **gros formulaire** (bloc « Imputation par défaut » Activité/Unité en grandes boîtes + bloc Montant/Catégorie), au lieu d'une ligne compacte ;
- fait **surgir une interface différente** au clic sur « Ajouter un détail » (le bloc défauts apparaît) au lieu de prolonger l'existant ;
- relègue mal l'information : le statut « À compléter · banque #… » est en haut, l'imputation (le vrai travail) est noyée.

Le bandeau replié, lui, part parfois sur **3 lignes** (montant / mode / Valider empilés à droite).

## Objectif

Resserrer le panneau autour de l'imputation, sans rien répéter du bandeau, et rendre le passage mono → ventilé **continu** (pas de changement d'écran). Cible = la maquette validée (artefact 2026-07-13).

## Décisions validées

1. **Imputation mise en avant**, en haut du déplié, sous forme d'une grille de lignes.
2. **Grille unifiée mono/ventilé**, colonnes `Unité · Catégorie · Activité · Montant · ✕` — **montant à droite** (cohérence app).
3. **Unité éditable par ligne** (chaque ventilation porte ses 3 dimensions CW ; une nouvelle ligne hérite des valeurs en cours). → **abandon du modèle « défauts globaux + lignes légères » (Option B) et du ⚙** livrés au sous-projet #20 : les lignes deviennent autonomes.
4. **« Ajouter un détail » en place** : la donnée existante devient la **1ʳᵉ ligne** (la colonne Montant apparaît, pré-remplie au total), et une **2ᵉ ligne** éditable s'ajoute, héritant Unité + Activité de la ligne précédente ; Catégorie et Montant à saisir. Aucun autre changement d'écran.
5. **Solde vivant** sous la grille : `✓ <total> — équilibré` (vert) si Σ = total, `⚠ reste <x> à ventiler` (ambre) si Σ < total, `⚠ dépasse de <x>` (rouge) si Σ > total. Validation CW bloquée tant que non équilibré + une ligne incomplète (déjà géré par `canSaveVentilation`).
6. **Pas de répétition du bandeau** : ni titre, ni date, ni montant dans le déplié.
7. **Statut en pied de bloc** : « À compléter » + « banque #… » descendent dans un footer, à côté des actions (⋯, Valider dans Comptaweb).
8. **Justificatifs en bas** du bloc (au-dessus du footer), inchangés.
9. **Mode de paiement dédié** : pastille compacte près du montant (dans le bandeau, donc visible replié ET déplié), séparée de l'imputation, éditable. Auto-renseignée pour les drafts bancaires (inférence existante `inferComptawebModeId` au scan). Badge « auto » optionnel (cosmétique, non bloquant).
10. **Bandeau replié sur 2 lignes max** : à droite, montant (ligne 1) puis `mode + Valider` (ligne 2), au lieu d'empiler trois éléments.

## Détail par zone

### Bandeau (ligne repliée — `ecritures-table.tsx`)
- Gauche : date | titre (éditable inline, inchangé) + chips d'imputation inline (unité/catégorie/activité, inchangés ; « Catégories multiples » remplace la catégorie quand l'écriture est un groupe ≥2). Le **mode sort des chips** pour rejoindre la pastille de droite.
- Droite : **montant** (ligne 1) ; **pastille mode + bouton Valider** (ligne 2). → 2 lignes.
- Le montant + la pastille mode vivent dans le bandeau (partagés replié/déplié).

### Panneau déplié (`ecriture-inline-panel.tsx`)
Ordre : **Imputation** (prioritaire) → **Justificatifs** → **Footer**.
- Plus aucun rappel titre/date/montant.
- **Footer** (bande basse, fond sunken) : à gauche statut (`⚠ À compléter`, `🏦 banque #…`), à droite actions (`⋯`, `✓ Valider dans Comptaweb`). Le bouton Valider du bandeau est masqué en déplié (il vit dans le footer), présent en replié.

### Grille d'imputation (nouveau composant, remplace/absorbe l'éditeur #20)
- En-tête de colonnes discret : `Unité · Catégorie · Activité · Montant`.
- **Mono** (1 ligne, `ventilation_group_id` nul) : colonnes Montant + ✕ masquées (largeur nulle) ; on ne voit que Unité/Catégorie/Activité. Édition d'un champ → `PATCH /api/ecritures/[id]/field` (comportement actuel conservé).
- **Ventilé** (après « + Ajouter un détail », ou groupe existant ≥2) : colonnes Montant + ✕ révélées ; N lignes autonomes ; solde vivant. Enregistrement → `PUT /api/ecritures/[id]/ventilations` avec les N `{amount_cents, category_id, unite_id, activite_id}` (endpoint et service `ventilateDraft` déjà livrés, déjà per-ligne).
- Transition mono → ventilé **en place** (révélation de colonne + ajout de ligne, animée, `prefers-reduced-motion` respecté).
- « Catégories multiples » affiché dans l'eyebrow de la section et dans le chip du bandeau quand ≥2 lignes.

### Mode de paiement
- Pastille compacte dans le bandeau, près du montant, éditable (liste des modes). Pour un draft bancaire, la valeur est déjà pré-remplie par l'inférence au scan.
- Reste éditable via `PATCH /field` (`mode_paiement_id`), comme aujourd'hui.

## Modèle & données

- **Aucune migration, aucun nouvel endpoint.** On réutilise `PATCH /api/ecritures/[id]/field` (mono) et `PUT /api/ecritures/[id]/ventilations` (ventilé, déjà livré #20).
- **Simplification de `ventilate-editor-model.ts`** : les lignes deviennent autonomes (`{ id, amount, category_id, unite_id, activite_id }`) — on **retire** `DefaultImputation`, le paramètre `defaults` et le champ `override`. `resolveVentilations` devient une simple projection ligne→`ResolvedVentilation` ; `editorRemainderCents`, `isMultiCategory`, `canSaveVentilation(total, rows)` conservés (signature de `canSaveVentilation` allégée : plus de `defaults`). Une nouvelle ligne hérite Unité/Activité de la ligne précédente au moment de l'ajout (logique du composant, pas du modèle).
- Le composant `VentilationEditor` #20 (défauts globaux + ⚙) est **remplacé** par la grille unifiée. Ses tests sont réécrits en conséquence.

## Hors scope

- Justif par ventilation (sous-projets A/B).
- Répartition recette parents (sous-projet C).
- Provenance « auto » du mode stockée en base (le badge « auto » reste cosmétique tant qu'on ne trace pas la provenance).

## Fichiers principaux touchés

- `web/src/components/ecritures/ecritures-table.tsx` — bandeau 2 lignes, mode en pastille droite, chip « Catégories multiples ».
- `web/src/components/ecritures/ecriture-inline-panel.tsx` — suppression des rappels d'en-tête, footer (statut + actions), ordre des sections, pastille mode.
- `web/src/components/ecritures/ventilation-editor.tsx` — refonte en grille unifiée (colonnes, montant à droite, unité par ligne, transition en place, solde vivant).
- `web/src/components/ecritures/ventilate-editor-model.ts` — simplification (lignes autonomes).
- `web/src/components/ecritures/ecriture-form.tsx` — l'imputation mono migre vers la grille unifiée (le hidden `category_id` multiCategory devient inutile si la grille gère l'affichage groupé).
