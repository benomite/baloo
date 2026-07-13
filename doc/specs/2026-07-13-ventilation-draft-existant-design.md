# Ventiler un draft existant — conception

**Date** : 2026-07-13
**Statut** : validé (design), prêt pour plan d'implémentation
**Dépend de** : S0 socle multi-ventilation (`2026-07-08-ecriture-multi-ventilation-design.md`)
**Recouvre** : sous-projet #20 « split manuel ligne bancaire », étendu à tout draft éditable

## Problème

S0 a livré la multi-ventilation **à la création** (wizard `/ecritures/nouveau` → N ventilations → 1 pièce CW). Mais une écriture **déjà existante** en `draft` — typiquement un draft bancaire issu du rapprochement (un paiement Leclerc de 100 € qui couvre 70 € intendance + 25 € petit matériel + 5 € pharmacie) — ne porte encore qu'**une seule** catégorie et sa validation CW (`drafts.ts::syncDraftToComptaweb`) envoie **1 ventilation en dur**. On perd l'information de ventilation, alors que CW sait porter N ventilations sur une pièce.

## Objectif

Permettre, sur un draft **pas encore matérialisé dans CW**, de **ventiler** le montant en N lignes, chacune avec ses 3 dimensions CW (Nature, Activité, Branche/Pôle = catégorie, activité, unité), et de pousser le tout en **1 seule pièce Comptaweb à N ventilations**.

## Périmètre

**Dans le périmètre** : tout draft éditable **non encore dans CW** — garde-fou `status = 'draft'` **et** `comptaweb_ecriture_id IS NULL`. Couvre les drafts bancaires (rapprochement) comme les brouillons saisis au wizard.

**Hors périmètre** :
- `mirror` / `divergent` : déjà dans CW, immuables (ADR-035, ADR-037). On ne ventile pas une pièce CW existante depuis Baloo.
- `pending_sync` : déjà poussée à CW, en attente de sync retour — la modifier désynchroniserait la pièce.
- **Justif par ventilation** : hors scope ici. Le justif reste attaché **au groupe** (porté par la ligne 1). Le rattachement d'un justif à une ventilation précise relève des sous-projets A (dépôt) / B (remboursement).

## Modèle UX (option « défauts globaux + lignes légères »)

Tout se passe **inline dans le panneau** du draft (`ecriture-inline-panel` / `pinned-ecriture-panel`), **jamais de modale**. Inspiration : le split de Dougs.

### Cas simple (1 ventilation) — inchangé
Le panneau reste exactement comme aujourd'hui : Nature / Activité / Unité en champs inline (`updateEcritureField`). Aucun bloc « VENTILATION », aucun défaut. Le comportement actuel n'est pas touché.

### Passage en mode ventilé
Un lien **« + Ajouter un détail »** dans le panneau. Au 1ᵉʳ clic, l'imputation unique bascule en **liste de ventilations** :

- Un bloc **« Imputation par défaut »** apparaît avec **Activité + Unité** (pré-remplies depuis l'imputation actuelle de l'écriture).
- **Ligne 1** = la Nature actuelle + le **montant total**.
- **Ligne 2** vide : Nature à choisir, montant 0 ; Activité/Unité **héritées du défaut**.

### Anatomie d'une ligne de ventilation
`Montant` + `Nature` (sélecteur catégorie) + `⚙` + `✕`.

- **Activité/Unité par défaut** = celles du bloc « Imputation par défaut ». Elles ne s'affichent pas sur la ligne tant qu'elles ne sont pas surchargées.
- **`⚙`** déplie, **pour cette ligne uniquement**, deux sélecteurs Activité/Unité permettant de **surcharger** le défaut. Une ligne surchargée affiche un marqueur discret (ex. « activité/unité personnalisées »).
- **`✕`** supprime la ligne.

### Sélecteur global
Changer l'Activité ou l'Unité dans le bloc « Imputation par défaut » **applique la valeur à toutes les lignes non surchargées** (les lignes avec `⚙` déplié/surchargé sont préservées). C'est le « sélecteur global » : on règle une fois pour toutes les lignes homogènes.

### Bandeau catégorie principal
Quand il y a **≥ 2 ventilations**, le sélecteur de catégorie du bandeau devient l'étiquette non cliquable **« Catégories multiples »** (comme Dougs). Retour à 1 ligne → il redevient un sélecteur normal montrant la catégorie unique.

### Indicateur de solde (le garde-fou)
Sous la liste, un indicateur du reste à ventiler, **total figé** (imposé par la ligne bancaire ou l'en-tête) :
- **✓ vert « 10,64 € — équilibré »** quand Σ ventilations = montant total.
- **ambre « reste 3,20 € à ventiler »** sinon.

Réutilise `ventilationsRemainderCents` (livré en S0).

### Enregistrement
Un bouton **« Enregistrer la ventilation »**, actif **seulement** quand : équilibré (reste = 0) **et** toute ligne complète (Nature + Activité + Unité résolues, montant ≠ 0). Il matérialise l'éclatement (cf. « Persistance »). La validation CW (**« Faire dans CW »**) reste par ailleurs désactivée tant que la ventilation n'est pas équilibrée.

## Persistance — éclatement atomique

À l'« Enregistrer la ventilation », via un nouvel endpoint (`PUT /api/ecritures/[id]/ventilations`) et un service dédié, dans **une transaction** (`db.transaction()`, pattern S0) :

- **Ligne 1 réutilise l'id existant** → justifs, notes, liens (dépôt/remboursement) et **identité bancaire** (`ligne_bancaire_id`, `sous_index`, `libelle_origine`) sont **préservés**. On y écrit sa Nature + Activité + Unité + montant + le `ventilation_group_id`.
- **Lignes 2..N** : nouvelles écritures `draft` créées avec les champs d'en-tête copiés (date, type, mode, description, `ligne_bancaire_id`, `sous_index`, `libelle_origine`, `justif_attendu`) + leur Nature/Activité/Unité/montant propres + le même `ventilation_group_id`.
- `ventilation_group_id` = `vg_<uuid>` si N ≥ 2, `null` si retour à 1.

**Retour à 1 ligne** : les lignes surnuméraires sont supprimées via `deleteDraftEcriture` (garde-fou existant : `draft` + aucune pièce attachée), la ligne restante repasse `ventilation_group_id = null`. Une ligne surnuméraire portant une pièce **bloque** la réduction (message explicite) — cohérent avec la règle « jamais de DELETE de donnée métier ».

**Préservation** : aucune valeur saisie n'est écrasée sans intention ; l'éclatement n'efface ni justif, ni note, ni lien (cf. CLAUDE.md « JAMAIS de DELETE »).

## Plomberie CW & sync

- **`syncDraftToComptaweb`** (`drafts.ts:~403`) : débridé pour envoyer **les N ventilations du groupe** (résolues via l'adapter, mapping CW par ligne — même logique que le chemin de création S0) en **1 pièce CW**. Le POST bas niveau (`buildPostBody`) supporte déjà N + valide Σ = total. À la réussite, **toutes** les lignes du groupe passent `pending_sync`/`mirror` ensemble (transition atomique).
- **`scanDraftsFromComptaweb`** : reconnaissance d'un draft bancaire par `sous_index + libelle_origine` — doit devenir **tolérante au N-match** (plusieurs lignes partagent la clé) et considérer le groupe comme « déjà représenté » (pas de recréation). Le **self-heal du sens** (`type`) s'applique à **toutes** les lignes du groupe.
- **Affichage** : déjà géré par S0 — `buildEcritureGroups` regroupe par `ventilation_group_id`, rendu groupé sous en-tête dans `ecritures-table`.

## Risque connu (hérité de S0)

Si deux ventilations d'un même groupe ont le **même montant** avec des natures différentes, l'appariement catégorie↔ligne à la réconciliation de sync (`reconcileVentilations`, pairing par montant) est **non déterministe**. Inoffensif ici (justif au niveau groupe, lignes fraîches à la promotion), mais **danger dès qu'on attachera un justif à une ventilation précise** (sous-projets A/B) → prévoir une clé d'appariement plus stable à ce moment-là. Documenté, non traité dans ce sous-projet.

## Fichiers principaux touchés

- `web/src/components/ecritures/` : bloc ventilation dans le panneau inline (nouveau composant), réutilise le répéteur/`ventilations-form.ts` de S0 ; bandeau « Catégories multiples ».
- `web/src/app/api/ecritures/[id]/ventilations/route.ts` : nouvel endpoint `PUT` (Zod : liste ventilations + invariant Σ = montant écriture).
- `web/src/lib/services/ecritures.ts` (ou service dédié `ecritures-ventilate.ts`) : service d'éclatement atomique + collapse.
- `web/src/lib/services/drafts.ts` : `syncDraftToComptaweb` débridé N ventilations ; `scanDraftsFromComptaweb` tolérant N-match + self-heal groupe.
- `web/src/lib/services/ecritures-create-cw-adapter.ts` : réutilisé pour le mapping CW par ligne.

## Hors scope / suite

- Justif par ventilation → sous-projets **A** (dépôt multi-catégories) / **B** (remboursement multi-catégories).
- Répartition recette groupe/territoire/national → sous-projet **C** (rentrée sept 2026), qui pourra réutiliser le bloc ventilation + un template.
