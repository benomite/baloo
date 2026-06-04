# Refonte de la vue Écritures (vue principale du trésorier)

- **Date** : 2026-06-04
- **Statut** : design validé en brainstorming, en attente de relecture
- **Périmètre** : `web/src/app/(app)/ecritures/` + composants associés
- **Inspiration** : workflow Dougs (deux sections à valider / validées, header trésorerie, bannière de correspondance, édition inline)

## Problème

La vue Écritures actuelle est un grand livre dense qu'on filtre. Trois faiblesses identifiées :

1. **Triple encodage du même état.** Les colonnes `Statut` (badge justif + badge Local/Synchro), `État` (icône CW synced + icône justif) et `⚠` (nb de champs manquants) répondent en réalité à deux questions seulement (*rapproché avec CW ?* / *justif présent ?*), avec deux colonnes quasi-doublons.
2. **La vue ne hiérarchise pas l'action.** Les écritures finies (`mirror`, read-only) cohabitent au même niveau visuel que celles qui réclament une action (brouillons, divergentes, sans justif).
3. **Aucun pouls financier.** En tête, seulement `N écritures` — jamais « où j'en suis » (solde, entrées/sorties).

## Décisions (validées avec l'utilisateur)

| Décision | Choix retenu | Conséquence |
|---|---|---|
| **Frontière À traiter / Bouclées** | **Sync CW strict** : `status = mirror` ⇒ Bouclées ; tout le reste ⇒ À traiter | Simple et binaire. La complétude n'entre pas dans le classement. |
| **Édition d'une ligne** | **Accordéon inline** sur place ; **drawer supprimé** ; page `/ecritures/[id]` conservée pour les cas lourds | « Ne pas perdre le fil ». |
| **Densité** | **Uniforme aérée** (style Dougs partout) | Bouclées étant longue ⇒ **repliée par défaut** + sous-sections par mois. |
| **Gate d'envoi CW** | Un brouillon **ne part pas à CW tant qu'il est incomplet** (`computeReadiness`) | Le CTA de la ligne est désactivé tant que catégorie/unité manquent. |
| **Incomplétude côté Bouclées** | **Hors scope** : une ligne miroir incomplète se résout dans CW, pas dans Baloo | Pas de marqueur de complétude sur Bouclées. |

## Design

### 1. Header financier (piste 3)

Bandeau sous le titre de page :

- `Solde de l'exercice` — réutilise `getOverview().solde` (`src/lib/services/overview.ts`), libellé honnête : on n'affiche **pas** un « solde de trésorerie bancaire » tant qu'on n'a pas de source bancaire fiable. Un vrai solde bancaire (rapprochement) reste une amélioration ultérieure.
- `Entrées du mois ↑` / `Sorties du mois ↓` — sommes recettes / dépenses du **mois courant**, en pills colorées (vert / rouge).
- Les totaux **se recalculent selon le filtre actif** (filtrer par unité ⇒ flux de cette unité). Le mois reste « courant » par défaut ; un filtre `month` actif prime.

### 2. Deux sections (pistes 1 + 2 fusionnées)

La **section dans laquelle se trouve une ligne EST son statut** → les colonnes `Statut` / `État` / `⚠` sont **supprimées**.

**« À traiter » (haut, déplié par défaut)** — `status ≠ mirror` :
- Regroupement par **ligne bancaire / écriture Comptaweb conservé** (utile pour les brouillons issus du rapprochement, cf. logique `EcrituresTable` actuelle).
- Lignes aérées (anatomie au §4).
- CTA de cycle de vie par ligne (Valider / Envoyer CW), **gated** par `computeReadiness` (§5).
- Une **puce contextuelle** « ce qui manque » (catégorie ? unité ? à envoyer ?) tant que la ligne n'est pas prête.

**« Bouclées » (bas, repliée par défaut)** — `status = mirror` :
- En-tête : `412 écritures bouclées [Déplier]`.
- Groupé **par mois**, sous-sections repliables, infinite scroll conservé.
- Trombone discret si justif présent. **Aucun** marqueur de complétude (hors scope).
- Pas de CTA ; reste éditable via l'accordéon.

### 3. Bannière de correspondance (piste justif de l'utilisateur)

Sous une ligne **sans justif**, si un dépôt à traiter ou un remboursement actif correspond probablement :

```
🔗 Un dépôt « Courses camp piok » semble correspondre · Lier   [Pas ça]
```

- Fond coloré discret (ambre), un seul **bouton « Lier » en un clic**.
- Réutilise le moteur de matching **inversé** : aujourd'hui `listCandidateEcritures` / `listCandidateRemboursements` (depots.ts) répondent « pour ce dépôt, quelles écritures ? ». On crée la requête symétrique « pour cette écriture, quel dépôt/remboursement probable ? » avec la même tolérance **±10 % montant / ±15 j date**.
- L'action « Lier » réutilise `attachDepotToEcriture` (déjà existant) / lien remboursement.
- **Perf** : calcul eager pour le bucket À traiter (petit) ; pour Bouclées, calcul à l'ouverture d'un mois (borné). Batch : une requête `suggestArtifactsForEcritures(ids[])` → map `ecritureId → { kind, id, label } | null`.

### 4. Anatomie d'une ligne aérée

```
04 │ ALDI MARCHE 139                 [Catégorie ▾]      −33,42 €   [Valider]
JUIN│ + ajouter une note · 📎 IMG-20260603.jpg ✕
    │ 🔗 Un dépôt « Courses camp » semble correspondre · Lier
```

- Date jour+mois à gauche, **rail couleur unité** conservé.
- Libellé (description) + lien note rapide.
- Catégorie en **dropdown inline** (réutilise `InlineSelect`).
- Montant coloré (dépense rouge / recette verte).
- CTA à droite (Valider / Envoyer CW), ou rien sur Bouclées.
- Chip justif attaché + bannière de correspondance le cas échéant.

### 5. CTA gated sur la complétude

Le passage `draft → pending_sync` (« Valider » / « Envoyer CW ») est **bloqué tant que la ligne est incomplète**. On réutilise `computeReadiness` (`src/lib/sync-readiness.ts`, niveaux `synced | ready | incomplete`) :
- `incomplete` ⇒ CTA désactivé + tooltip listant ce qui manque + puce contextuelle sur la ligne.
- `ready` ⇒ CTA actif.

### 6. Édition accordéon inline

- Clic sur une ligne → **déplie un panneau d'édition sur place** ; le `EcritureDrawer` est supprimé.
- **Édition des champs instantanée** depuis les données déjà chargées (même approche que les cellules inline actuelles), sans aller-retour serveur pour commencer à éditer.
- **Zone justif** (voir / attacher / match suggéré) **hydratée à l'ouverture** via le mécanisme `?detail=id` existant (le serveur charge déjà `listJustificatifsForEcriture` + dépôts à traiter).
- L'URL `?detail=id` est **conservée** (linkabilité, refresh) mais rend désormais l'accordéon inline au lieu du drawer.
- Lien **« ouvrir en grand »** vers `/ecritures/[id]` (cas lourds : justifs multiples, historique).

### 7. Ce qu'on jette de Dougs

TVA inline, « dont TVA 20 % », indemnité kilométrique, apport en compte courant d'associé, toggle « soumise à la TVA ? ». **Aucun** n'a de sens en assoc SGDF. On garde uniquement le **pattern** de micro-formulaire contextuel sous la ligne, pour : unité, activité, catégorie, carte, lien dépôt/remboursement.

## Données & requêtes

| Besoin | Source | Statut |
|---|---|---|
| Solde / dépenses / recettes | `getOverview()` (overview.ts) | existe |
| Entrées / sorties du mois courant (filtre-aware) | dérivé de `listEcritures` filtres + agrégat | à ajouter (léger) |
| Split en deux buckets | `listEcritures` + discriminant `bucket: 'a_traiter' \| 'bouclees'` (≈ `status = mirror` ou non) | à ajouter |
| Gate de complétude | `computeReadiness` (sync-readiness.ts) | existe |
| Bannière de correspondance | nouvelle `suggestArtifactsForEcritures(ids[])`, tolérance ±10 %/±15 j (réutilise la logique des candidates dépôts/remboursements) | à ajouter |
| Lier en un clic | `attachDepotToEcriture` / lien remboursement | existe |

## Composants impactés

- `web/src/app/(app)/ecritures/page.tsx` — header financier, deux sections, chargement des suggestions.
- `web/src/components/ecritures/ecritures-table.tsx` — passe en lignes aérées ; suppression colonnes `Statut`/`État`/`⚠` ; accordéon inline ; bannière.
- `web/src/components/ecritures/ecriture-drawer.tsx` — **supprimé** (contenu réintégré en accordéon inline / page détail).
- `web/src/components/ecritures/ecritures-infinite-list.tsx` — gère les deux buckets + repli Bouclées.
- `web/src/lib/services/overview.ts` / nouvelle query suggestions.
- `web/src/app/(app)/ecritures/[id]/page.tsx` — conservée (« ouvrir en grand »).

## Hors scope

- Complétude des lignes **miroir** (incomplètes côté CW) : se résout dans Comptaweb, pas dans Baloo.
- Toute notion fiscale (TVA, etc.).
- Vues sauvegardées comme tabs (piste 8) : possible itération ultérieure.
- Navigation clavier (piste 5) : itération ultérieure, après assainissement de la structure.

## Ordre de construction suggéré

Découpage incrémental, chaque étape livrable et testable seule :

1. **Split + nettoyage colonnes** : deux sections À traiter / Bouclées (`status = mirror`), repli Bouclées par défaut, suppression `Statut`/`État`/`⚠`. *(Plus gros gain de simplification, risque maîtrisé.)*
2. **Header financier** : solde de l'exercice + entrées/sorties du mois, filtre-aware.
3. **Bannière de correspondance** : query `suggestArtifactsForEcritures`, bannière + Lier en un clic.
4. **Lignes aérées + accordéon inline** : passage au style aéré, réintégration du form en accordéon, **suppression du drawer**, gate `computeReadiness` sur le CTA. *(Étape la plus risquée — chemin critique d'édition — faite en dernier, page détail comme filet.)*

## Risques

- **Perf des suggestions** : borner strictement (eager sur À traiter seulement ; lazy par mois sur Bouclées). Ne jamais calculer pour l'ensemble des miroirs d'un coup.
- **Solde affiché** : ne pas afficher un « solde trésorerie » trompeur si la source bancaire fiable n'existe pas ; rester sur le solde réellement calculable (`getOverview`).
- **Régression de l'édition** : la suppression du drawer touche un chemin critique (compléter une écriture). Migration soignée du contenu du form + justifs vers l'accordéon, en conservant la page détail comme filet.
- **Préservation données** (CLAUDE.md) : le « Lier en un clic » et l'édition inline ne doivent jamais écraser une valeur saisie ni casser un lien FK (UPSERT / liens existants respectés).
