# Titres parlants pour les écritures bancaires

**Date** : 2026-06-30
**Statut** : design validé (brainstorming)

## Problème

Les brouillons d'écritures générés depuis les lignes bancaires (`scanDraftsFromComptaweb`)
reçoivent un libellé auto = l'intitulé bancaire nettoyé. Pour les paiements carte
(« PAIEMENT C. PROC … FR FRANCE ») c'est cryptique. L'utilisateur laisse souvent ce
libellé par défaut → compta peu lisible. Aujourd'hui le titre n'est éditable que via le
formulaire complet (drawer / page détail), pas dans la liste : friction trop élevée.

Objectif : rendre le renommage **fluide depuis la liste**, et **inciter** (utilisateur +
MCP) à le faire — sans jamais le **forcer** (non bloquant).

## Contrainte structurante (miroir strict, ADR-032)

- À la validation d'un brouillon, le push CW envoie `libel: ecr.description`
  (`drafts.ts:335`) → **renommer un brouillon propage le titre dans Comptaweb**.
- Le sync réécrit la `description` d'une écriture `mirror` depuis CW
  (`sync-cycle.ts:445`) → renommer localement une écriture déjà dans CW serait écrasé.

**Conséquence** : on renomme **au stade brouillon** ; c'est ce titre qui part dans CW.
Une écriture déjà dans Comptaweb se renomme **dans CW**, pas dans Baloo.

## Décisions

### 1. Donnée — `libelle_origine`

- Nouvelle colonne `ecritures.libelle_origine` (TEXT, nullable).
- Posée à la génération du brouillon bancaire : `libelle_origine = description` (libellé
  brut). **Figée**, jamais réécrite (sert aussi de référence de rapprochement futur).
- Champ calculé (lecture) `titre_a_renommer` =
  `status éditable (draft) AND libelle_origine IS NOT NULL AND description = libelle_origine`.
- Migration : `ALTER TABLE ecritures ADD COLUMN libelle_origine TEXT` (nullable, convention
  libsql) + colonne dans le `CREATE TABLE` de `business-schema.ts`.

### 2. UX liste — nudge V1 + édition inline

- **Nudge V1** : un titre `titre_a_renommer` s'affiche en **gris atténué + italique**,
  précédé d'une icône crayon ✎. Tooltip : « Libellé bancaire brut — clique pour préciser
  (ce titre partira dans Comptaweb) ». Une fois renommé → rendu normal, plus d'icône.
- **Édition inline** : clic sur le titre → `<input>` texte **pré-rempli avec la description,
  tout sélectionné** au focus. Entrée valide (`updateEcritureField(id, 'description', v)` +
  `refreshRow`), Échap annule, blur valide. Nouveau composant `InlineText` (frère de
  `InlineSelect`).
- Actif **uniquement** sur les écritures éditables (`isEditable`, donc pas `mirror` /
  `divergent`). Une `mirror` affiche le libellé CW, non éditable.

### 3. Backfill ciblé de l'existant (one-shot)

- Migration : pour les **brouillons bancaires** (`ligne_bancaire_id IS NOT NULL AND
  status = 'draft' AND libelle_origine IS NULL`) dont la `description` matche un pattern
  « libellé bancaire brut » (marqueurs `PAIEMENT`, `C. PROC`, `FR FRANCE`, `VIR ` +
  dominance majuscules), poser `libelle_origine = description`.
- Conservateur : mieux vaut rater quelques bruts que marquer « à renommer » un titre déjà
  soigné. Les écritures déjà renommées et les `mirror` ne sont pas touchées.

### 4. MCP

- `list_ecritures` renvoie `libelle_origine` + `titre_a_renommer`.
- Description du tool `update_ecriture` enrichie : « remplacer le libellé bancaire brut par
  un titre parlant est une étape importante du nettoyage compta — non bloquante, mais à
  proposer à l'utilisateur ». Note équivalente dans `CLAUDE.md`.

## Tests

- **Détection** (`titre_a_renommer`) : draft brut → true ; draft renommé → false ;
  mirror brut → false (non éditable).
- **Backfill** : brouillon bancaire brut → `libelle_origine` posé ; brouillon déjà
  renommé → non touché ; mirror → non touché ; écriture manuelle (sans `ligne_bancaire_id`)
  → non touchée.
- **Génération** (`scanDraftsFromComptaweb`) : un nouveau brouillon bancaire reçoit
  `libelle_origine = description`.
- **Inline edit** (`InlineText`) : Entrée appelle le save avec la valeur ; Échap annule.

## Hors scope (YAGNI)

- Onglet / filtre global « À renommer » (écarté : le nudge par ligne suffit).
- Renommage des écritures déjà dans CW (relève de Comptaweb, miroir strict).
- Suggestion automatique de titre (commerçant, IA) — éventuellement plus tard côté MCP.
