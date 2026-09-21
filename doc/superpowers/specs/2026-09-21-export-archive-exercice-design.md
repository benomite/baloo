# Export d'archive : dump technique et dossier d'exercice

**Date** : 2026-09-21
**Statut** : design validé — prêt pour le plan d'implémentation
**ADR** : ADR-040
**Contexte** : clôture de l'exercice 2025-2026 (clôture groupe au 30/09/2026, validation nationale jusqu'à début décembre). `groupes.dernier_exercice_clos` est encore `null` au 2026-09-21.

## Problème

Baloo porte aujourd'hui l'intégralité de la compta opérationnelle du groupe, et rien ne permet d'en sortir une copie complète. Trois manques distincts :

1. **Sécurité** — une migration ratée, une erreur de manipulation ou une panne Turso/Vercel/Blob ferait perdre des données qu'aucun autre système ne détient : justificatifs uploadés, notes d'écriture, liens dépôt ↔ écriture, imputations corrigées à la main. Le coût de resaisie est très élevé (cf. la règle « JAMAIS de DELETE » de `CLAUDE.md`, qui protège la même valeur).
2. **Passation** — le successeur du trésorier, ou le reste du bureau, doit pouvoir lire une année de compta **sans accès à Baloo**. Aujourd'hui la seule sortie est le CSV d'écritures de `/ecritures` : il ne contient ni justificatifs, ni remboursements, ni abandons, ni caisse, ni la mémoire (notes, todos) qui explique les cas particuliers.
3. **Obligation** — pouvoir ressortir une pièce justificative plusieurs années après. Besoin réel mais secondaire tant que Baloo est en ligne ; il est satisfait comme sous-produit des deux premiers.

Ces besoins ont des exigences **opposées** : la sécurité veut de la fidélité brute et de la fréquence, la passation veut de la lisibilité et un découpage annuel. Les servir avec un seul artefact produit un résultat médiocre pour les deux.

## Design

### 1. Deux artefacts, deux régimes de confidentialité

| | Dump technique | Dossier d'exercice |
|---|---|---|
| **Sert** | la sécurité (restauration) | la passation et l'obligation |
| **Périmètre** | toute la base, toutes années | un exercice (01/09/N → 31/08/N+1) |
| **Déclenchement** | quand on veut, indépendant du calendrier de clôture | à la clôture d'un exercice |
| **Destination** | disque du trésorier + sa sauvegarde perso | Drive du groupe |
| **Contenu sensible** | **conservé** (RIB, tokens) — c'est un backup, il doit être fidèle | **caviardé à la source** |

Le découplage du dump et du calendrier de clôture est intentionnel : un export annuel ne protège pas les six mois écoulés depuis la dernière clôture.

La séparation résout aussi la question de la confidentialité sans réglage à choisir. Le seul artefact qui circule est déjà caviardé ; le caviardage n'est pas une option du script, c'est le comportement par défaut de `export-exercice`, et il ne peut pas être désactivé.

### 2. Exécution : script local, pas de bouton webapp

Les deux exports sont des scripts `web/scripts/*.ts` lancés en `pnpm tsx`, avec accès direct à la base via `getCliContext()` — comme `import-personnes.ts`, `bootstrap.ts` et les autres scripts existants.

Raisons :

- **Vercel est hostile à cet usage** : `maxDuration` 60 s, filesystem en lecture seule sauf `/tmp` éphémère. Une année de camps représente plusieurs centaines de fichiers dans Vercel Blob. Un export qui casse à 80 % dans une fonction serverless ne se reprend pas.
- **Le filet de sécurité ne doit pas dépendre de ce qu'il protège.** Un script qui lit la base directement fonctionne même si l'UI est cassée — c'est-à-dire précisément le jour où on en a besoin.
- **L'artefact demandé est un dossier**, pas un téléchargement. Le script l'écrit là où le trésorier le veut.

Contrepartie assumée : seul le trésorier qui a les accès locaux peut déclencher un export. Acceptable en mono-groupe. Le découpage de code (§6) garde la porte ouverte à un `/admin/export` en P3 sans réécrire la collecte.

### 3. Artefact A — dump technique

```
baloo-dump-YYYY-MM-DD/
  tables/<table>.jsonl      une ligne JSON par enregistrement
  blobs/<justif_id>.<ext>   tous les fichiers, nommés par id (stable)
  blobs/index.json          id → nom d'origine, entity_type/id, mime, sha256, octets
  manifest.json             date, commit git, lignes par table, nb blobs,
                            octets totaux, liste des tables exclues
```

**Sélection des lignes** — trois régimes, car toutes les tables ne portent pas `group_id` :

| Régime | Tables | Règle |
|---|---|---|
| Portant `group_id` | `ecritures`, `remboursements`, `abandons_frais`, `justificatifs`, `depots_justificatifs`, `mouvements_caisse`, `unites`, `activites`, `cartes`, `personnes`, `camps`, `notes`, `todos`… | `WHERE group_id = ?` |
| Référentiels globaux | `categories`, `modes_paiement` | exportées entières (elles ne sont pas propres au groupe) |
| Atteintes par FK | `signatures`, `remboursement_lignes`, `remboursement_ligne_justificatifs`, `budget_lignes`, `avances_camp` | filtrées par jointure sur leur parent déjà retenu |

Le troisième régime est le piège : ces tables n'ont pas de `group_id`, et un `SELECT *` y exporterait les données de tous les groupes le jour où le multi-tenant sera activé (P3). Le régime de chaque table est déclaré dans la même constante que la classification incluse/exclue, donc couvert par le test de complétude.

**Tables exclues en dur** (secrets et authentification) : `comptaweb_credentials`, `api_tokens`, `oauth_clients`, `oauth_access_tokens`, `oauth_authorization_codes`, `sessions`, `login_codes`, `signin_attempts`, `verification_tokens`, `invite_links`.

Cette liste est une constante, et la classification de **chaque** table du schéma est vérifiée par un test : une table nouvelle qui n'est ni dans la liste incluse ni dans la liste exclue fait échouer la suite. Sans ce garde-fou, une table d'auth ajoutée plus tard partirait silencieusement dans les dumps suivants.

**Reprenable** : le script écrit au fil de l'eau et saute un blob déjà présent dont le sha256 correspond. Une coupure réseau se rattrape en relançant.

### 4. Artefact B — dossier d'exercice

```
exercice-2025-2026/
  README.md                    synthèse, périmètre, date d'export, contrôles (§5)
  index.html                   navigable hors-ligne, liens relatifs
  01-ecritures/
    ecritures.csv              libellés résolus (unité, catégorie, activité, mode)
    justificatifs/<date>-<piece>-<slug>/…
  02-remboursements/
    remboursements.csv
    signatures.csv
    <REMB-id>-<nom>/feuille.pdf + justificatifs
  03-abandons/
    abandons.csv
    signatures.csv
    <ABD-id>/cerfa.pdf + justificatifs
  04-caisse/
    mouvements.csv  ·  depots-especes.csv  ·  depots-cheques.csv
  05-depots-orphelins/         dépôts rattachés à aucune écriture + leurs fichiers
  06-referentiels/
    unites.csv · categories.csv · activites.csv · modes-paiement.csv
    comptes.csv · cartes.csv · camps.csv · personnes.csv
  07-memoire/
    notes.md  ·  todos.md
  08-comptaweb/
    rapprochement.csv          numero_piece ↔ écriture, écarts éventuels
  avances-camp.csv
```

**Champs caviardés**, systématiquement : `remboursements.rib_texte`, `remboursements.rib_file_path` (et le fichier RIB lui-même n'est pas copié), `remboursements.edit_token`, `remboursements.validate_token`.

Les tokens sont le point le plus important : ce sont les liens d'accès direct introduits le 2026-06-17. Exportés tels quels dans un Drive partagé, ils permettraient à quiconque détient le dossier de **modifier ou valider un remboursement en production**. Les RIB, eux, n'ont aucune valeur d'archive : ils ne servent qu'à payer, et le paiement est fait.

Les emails sont **conservés** : un successeur doit pouvoir recontacter un demandeur.

**Décisions de contenu** :

- **Pas de section « camps »**. La table `camps` ne porte que nom, unité, activité, dates, statut et notes ; le bilan financier est dérivé des écritures. Elle est exportée comme référentiel (`06-referentiels/camps.csv`) pour que les libellés restent lisibles, sans section dédiée.
- **`avances-camp.csv` à la racine**, en revanche : `avances_camp` porte `beneficiaire`, `montant_rendu_cents`, `statut` et `notes`, qui n'existent nulle part ailleurs. Le versement d'une avance est une écriture, mais *combien est revenu et si l'avance est soldée* n'est que là. Une avance non clôturée au 31/08 est exactement ce qu'un successeur doit voir.
- **Pas de budgets** dans le dossier d'exercice (ils restent dans le dump). Le prévisionnel éclaire le pilotage de l'année en cours, pas la lecture d'une année close.
- **Signatures exportées** (`signatures.csv` dans `02-` et `03-`), en plus de l'encart déjà rendu dans les PDF. Sans la chaîne de signature — rôle, horodatage, `data_hash`, IP — un PDF signé n'est qu'un PDF : c'est la chaîne qui porte la valeur probante.
- **Remboursements jamais signés** : pas de PDF en base (il n'est généré qu'à la signature, cf. `remboursement-signing.ts`). Ils sont listés dans le CSV et l'index avec la mention « non signé ». Aucun PDF n'est généré a posteriori — un document produit à l'export n'aurait rien signé.
- **Justificatifs obsolètes** (`obsolete_at` non nul) : inclus, dans un sous-dossier `_obsoletes/` de leur écriture. Traçabilité sans polluer la lecture.
- **Écritures en `draft` / `pending_cw` / `pending_sync`** à la date d'export : incluses, avec leur statut en clair dans le CSV et signalées dans les contrôles. Un successeur doit voir ce qui n'était pas matérialisé dans Comptaweb.

Le CSV d'écritures **réutilise le formateur existant** de `web/src/app/api/ecritures/export/route.ts` (BOM UTF-8, virgule décimale, échappement RFC 4180, résolution des FK en libellés), extrait dans un module partagé plutôt que dupliqué.

### 5. Contrôles de cohérence

Le script ne se contente pas de copier : il vérifie et écrit le résultat en tête du `README.md` du dossier d'exercice.

- Écritures avec `justif_attendu = 1` et aucun justificatif attaché
- Remboursements en statut `paye` sans PDF signé
- Dépôts de justificatifs rattachés à aucune écriture
- Blobs référencés en base et introuvables dans le store
- Total Baloo vs total Comptaweb, mois par mois
- Écritures encore en `draft` / `pending_cw` / `pending_sync`

C'est ce qui donne à l'export sa valeur opérationnelle : **lancé avant** de déclarer l'exercice clos, il dit ce qui manque pendant qu'il est encore temps de le corriger. Les contrôles ne bloquent jamais l'export — ils décrivent.

### 6. Périmètre et découpage du code

Les bornes d'exercice viennent de `exercices-actifs.ts` et `exercice-pour-ecriture.ts`, déjà écrits et testés (ADR-039). Aucune redéfinition du 01/09 → 31/08 dans ce chantier.

- **`web/src/lib/services/export-archive.ts`** — collecte et transformations **pures** : sélection du périmètre, classification des tables, caviardage, contrôles de cohérence, construction de l'arborescence cible. Zéro I/O. C'est là que vivent les invariants, et c'est ce qui est testé.
- **`web/scripts/export-dump.ts`** et **`web/scripts/export-exercice.ts`** — I/O seulement : lecture base, téléchargement des blobs, écriture disque, affichage de progression.

Ce découpage n'est pas cosmétique : il garde la logique réutilisable pour un éventuel `/admin/export` en P3, où seule la couche I/O changerait (stream ZIP au lieu d'écriture disque).

**Parité MCP ↔ app** (ADR-038) : asymétrie volontaire. L'export n'est pas une opération métier sur les données, c'est un utilitaire d'administration local ; aucun tool MCP n'est ajouté. Noté dans l'ADR-040.

### 7. Tests

TDD sur `export-archive.ts`, avec des fixtures SQLite en mémoire selon le pattern des tests de services existants (`web/src/lib/services/__tests__/`). Les blobs sont mockés.

- **Bornes d'exercice** : une écriture au 31/08 est dedans, une au 01/09 est dehors.
- **Caviardage** : un cas par champ sensible (`rib_texte`, `rib_file_path`, `edit_token`, `validate_token`), vérifiant l'absence de la valeur dans la sortie sérialisée — pas seulement l'absence de la clé.
- **Classification des tables** : toute table du schéma est soit incluse (avec son régime de sélection), soit explicitement exclue. Test de complétude sur la liste réelle des tables.
- **Régime de sélection** : une ligne d'un autre `group_id` n'apparaît pas dans la sortie, y compris via les tables atteintes par FK (`signatures`, `remboursement_lignes`).
- **Contrôles de cohérence** : un cas positif et un cas négatif chacun.
- **Arborescence** : noms de dossiers stables et sûrs pour un système de fichiers (accents, `/`, longueur) à partir de libellés réels.

## Points ouverts

- **Volume réel non mesuré** au 2026-09-21. Si le dump complet s'avère trop lourd pour une sauvegarde régulière, la sortie de secours est de séparer les blobs (qui sont immuables et déjà répliqués côté Vercel Blob) des tables (qui changent en continu) — à trancher sur données, pas avant.
- **Restauration non couverte par ce chantier.** Le dump est conçu pour être fidèle et relisible, mais aucun script de réimport n'est écrit ici. Écrire un import qui ne viole pas la règle « JAMAIS de DELETE » est un sujet à part entière ; le tenter en même temps diluerait les deux.
