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
  manifest.json             date, commit git, lignes par table, tables en échec,
                            tables inconnues, nb blobs, octets totaux,
                            liste des tables exclues
```

**Sélection des lignes** — quatre régimes, car toutes les tables ne portent pas `group_id` :

| Régime | Tables | Règle |
|---|---|---|
| Racine | `groupes` | `WHERE id = ?` — la table EST le groupe, pas de colonne `group_id` |
| Portant `group_id` | `ecritures`, `remboursements`, `abandons_frais`, `justificatifs`, `depots_justificatifs`, `mouvements_caisse`, `unites`, `activites`, `cartes`, `personnes`, `camps`, `notes`, `todos`… | `WHERE group_id = ?` |
| Référentiels globaux | `categories`, `modes_paiement` | exportées entières (elles ne sont pas propres au groupe) |
| Atteintes par FK | `signatures`, `remboursement_lignes`, `remboursement_ligne_justificatifs`, `budget_lignes`, `avances_camp` | filtrées par jointure sur leur parent déjà retenu |

Le régime par FK est le piège : ces tables n'ont pas de `group_id`, et un `SELECT *` y exporterait les données de tous les groupes le jour où le multi-tenant sera activé (P3). Le régime de chaque table est déclaré dans la même constante que la classification incluse/exclue, donc couvert par le test de complétude.

**Tables exclues en dur**, en deux catégories :

- **Secrets et authentification** : `comptaweb_credentials`, `api_tokens`, `oauth_clients`, `oauth_access_tokens`, `oauth_authorization_codes`, `sessions`, `login_codes`, `signin_attempts`, `verification_tokens`, `invite_links`.
- **Sans rattachement à un groupe** : `error_log`. Ce n'est pas un secret, mais elle n'a aucune colonne exploitable pour la borner (ni `group_id`, ni clé étrangère) — l'exporter entière ferait fuiter les erreurs de tous les groupes dès l'activation du multi-tenant (P3).

Cette liste est une constante, et la classification de **chaque** table du schéma est vérifiée par un test : une table nouvelle qui n'est ni dans la liste incluse ni dans la liste exclue fait échouer la suite. Sans ce garde-fou, une table d'auth ajoutée plus tard partirait silencieusement dans les dumps suivants.

**Reprenable** : le script écrit chaque blob dans un fichier temporaire puis le renomme vers son nom final. `rename` étant atomique sur un même système de fichiers, un fichier présent sous son nom final est **forcément complet** — la simple présence suffit donc à sauter un blob, et une coupure (réseau, interruption, disque plein) se rattrape en relançant.

Le `sha256` de `blobs/index.json` sert à **vérifier l'intégrité de l'archive**, pas à décider d'un saut : refaire le hash de chaque fichier à chaque run coûterait une relecture complète du dump pour une garantie que l'atomicité donne déjà. *(Précision apportée le 2026-09-28 : la rédaction initiale de cette section fondait la reprise sur le hash, ce qui était à la fois plus coûteux et moins sûr que l'écriture atomique retenue à l'implémentation.)*

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
    <REMB-id>-<nom>/ justificatifs   (pas de feuille.pdf : cf. note ci-dessous)
  03-abandons/
    abandons.csv                 (colonne cerfa_emis + date : cf. note ci-dessous)
    <ABD-id>/ justificatifs
  04-caisse/
    mouvements.csv  ·  depots-especes.csv  ·  depots-cheques.csv
  05-depots-orphelins/         dépôts rattachés à aucune écriture + leurs fichiers
  06-referentiels/
    unites.csv · categories.csv · activites.csv · modes_paiement.csv
    comptes_bancaires.csv · cartes.csv · camps.csv · personnes.csv
  07-memoire/
    notes.md  ·  todos.md
  avances-camp.csv
```

**Pas de dossier `08-comptaweb/` dédié.** Le pont ligne à ligne avec la comptabilité officielle (`numero_piece`, `comptaweb_id`) est déjà une colonne de `01-ecritures/ecritures.csv`, au grain le plus fin ; les écarts entre Baloo et Comptaweb sont déjà remontés par les contrôles `ecart_miroir` et `ecriture_divergente` (§5), en tête du README de l'archive. Un fichier séparé n'aurait fait que dupliquer ces données, avec le risque classique qu'elles finissent par diverger entre les deux sources.

**Champs caviardés**, systématiquement : `remboursements.rib_texte`, `remboursements.rib_file_path` (et le fichier RIB lui-même n'est pas copié), `remboursements.edit_token`, `remboursements.validate_token`, ainsi que `comptes_bancaires.iban`, `comptes_bancaires.bic`, `groupes.iban_principal` et `personnes.telephone`.

Les tokens sont le point le plus important : ce sont les liens d'accès direct introduits le 2026-06-17. Exportés tels quels dans un Drive partagé, ils permettraient à quiconque détient le dossier de **modifier ou valider un remboursement en production**. Les RIB et les IBAN/BIC, eux, n'ont aucune valeur d'archive une fois l'exercice clos : ils ne servent qu'à effectuer des paiements, et les paiements sont faits — un compte reste identifiable par son code, son nom et sa banque.

Les emails sont **conservés** : un successeur doit pouvoir recontacter un demandeur. Le téléphone, lui, est retiré : plus intrusif que l'email et sans valeur d'archive — ce point n'avait pas été tranché à la rédaction initiale de cette section.

**Décisions de contenu** :

- **Pas de section « camps »**. La table `camps` ne porte que nom, unité, activité, dates, statut et notes ; le bilan financier est dérivé des écritures. Elle est exportée comme référentiel (`06-referentiels/camps.csv`) pour que les libellés restent lisibles, sans section dédiée.
- **`avances-camp.csv` à la racine**, en revanche : `avances_camp` porte `beneficiaire`, `montant_rendu_cents`, `statut` et `notes`, qui n'existent nulle part ailleurs. Le versement d'une avance est une écriture, mais *combien est revenu et si l'avance est soldée* n'est que là. Une avance non clôturée au 31/08 est exactement ce qu'un successeur doit voir.
- **Pas de budgets** dans le dossier d'exercice (ils restent dans le dump). Le prévisionnel éclaire le pilotage de l'année en cours, pas la lecture d'une année close.
- **Signatures exportées** (`signatures.csv` dans `02-` uniquement), en plus de l'encart déjà rendu dans les PDF. Sans la chaîne de signature — rôle, horodatage, `data_hash`, IP — un PDF signé n'est qu'un PDF : c'est la chaîne qui porte la valeur probante. Les abandons de frais ne sont **jamais** signés électroniquement dans Baloo (la seule valeur de `signatures.document_type` jamais écrite en base est `'remboursement'`) : `03-abandons/` n'a donc pas de `signatures.csv`.
- **Pas de `cerfa.pdf`** dans `03-abandons/<id>/` : Baloo ne génère aucun CERFA, il revient du national après envoi — `abandons_frais.cerfa_emis` n'est qu'un drapeau booléen (posé à la main par le trésorier), sans fichier associé. Il est exporté tel quel, avec sa date, dans `abandons.csv`. Le dossier `<id>/` ne contient donc que les justificatifs de la demande.
- **Remboursements jamais signés** : pas de PDF en base (il n'est généré qu'à la signature, cf. `remboursement-signing.ts`). Ils sont listés dans le CSV et l'index avec la mention « non signé ». Aucun PDF n'est généré a posteriori — un document produit à l'export n'aurait rien signé.
- **`feuille.pdf` n'est PAS copiée dans l'archive**, signée ou non — décision utilisateur du 2026-09-28. `feuille-remboursement.ts` imprime l'IBAN du demandeur en clair pour permettre le paiement ; le copier dans une archive destinée à un Drive partagé contournerait tout le caviardage par un simple fichier. Ce qui reste dans `02-remboursements/` : la colonne `feuille_signee` de `remboursements.csv` (laquelle a été signée), `signatures.csv` (la chaîne de signature, valeur probante), et les justificatifs des lignes de la demande, qui ne contiennent aucun IBAN. La feuille elle-même reste consultable dans Baloo. Pas de fichier `NON-SIGNE.txt` non plus : il levait l'ambiguïté d'un dossier sans feuille, question qui ne se pose plus puisqu'aucun dossier n'en a.
- **Périmètre temporel par entité** : les écritures sont bornées sur `date_ecriture`, les abandons sur `date_depense`, les mouvements de caisse sur leur date d'opération, les remboursements sur `COALESCE(date_depense, created_at)` — c'est la borne déjà retenue par `queries/cloture.ts`, une demande pouvant être déposée sans date de dépense.
- **Justificatifs obsolètes** (`obsolete_at` non nul) : inclus, dans un sous-dossier `_obsoletes/` de leur écriture. Traçabilité sans polluer la lecture.
- **Écritures en `draft` / `pending_cw` / `pending_sync`** à la date d'export : incluses, avec leur statut en clair dans le CSV et signalées dans les contrôles. Un successeur doit voir ce qui n'était pas matérialisé dans Comptaweb.

Le CSV d'écritures **réutilise le formateur existant** de `web/src/app/api/ecritures/export/route.ts` (BOM UTF-8, virgule décimale, échappement RFC 4180, résolution des FK en libellés), extrait dans un module partagé plutôt que dupliqué.

### 5. Contrôles de cohérence

Le script ne se contente pas de copier : il vérifie et écrit le résultat en tête du `README.md` du dossier d'exercice.

| Contrôle | Définition exacte |
|---|---|
| Écritures sans justificatif | `type = 'depense'`, `justif_attendu = 1`, aucun `justificatifs` avec `entity_type = 'ecriture'` et `obsolete_at IS NULL` |
| Remboursements aboutis sans PDF signé | `status IN ('virement_effectue', 'termine')` et aucun `justificatifs` avec `entity_type = 'remboursement_feuille'` |
| Dépôts orphelins | `depots_justificatifs` avec `ecriture_id IS NULL` et `remboursement_id IS NULL`, statut ≠ `rejete` |
| Blobs manquants | `justificatifs.file_path` référencé en base, absent du store (seul contrôle avec I/O) |
| Écarts de miroir | écritures dont le `status` ≠ `mirror`, groupées par statut et par mois, avec le montant total concerné |
| Écritures divergentes | `status = 'divergent'` — Baloo et Comptaweb ne disent pas la même chose |

Deux précisions qui ont leur importance :

- **Les statuts de remboursement** sont `a_traiter`, `valide_tresorier`, `valide_rg`, `virement_effectue`, `termine`, `refuse`, `converti` (`lib/types.ts`). Il n'y a pas de statut « payé » : les deux statuts qui signifient « c'est allé au bout » sont `virement_effectue` et `termine`.
- **L'écart de miroir ne se mesure pas contre `comptaweb_lignes`**, qui n'est que le cache du dernier import CSV et peut être périmé de plusieurs mois. La source fiable est le statut de l'écriture elle-même : une écriture `mirror` porte un `comptaweb_ecriture_id` et *est* Comptaweb (ADR-035). Tout ce qui n'est pas `mirror` est, par définition, un écart.

C'est ce qui donne à l'export sa valeur opérationnelle : **lancé avant** de déclarer l'exercice clos, il dit ce qui manque pendant qu'il est encore temps de le corriger. Les contrôles ne bloquent jamais l'export — ils décrivent.

**Relation avec `queries/cloture.ts`.** La page `/cloture` calcule déjà trois de ces règles, mais en **comptages** mensuels, et via `getCurrentContext()` — donc inutilisable depuis un script CLI, qui n'a pas de session HTTP. L'export a besoin des **listes**, pas des compteurs. Les contrôles sont donc écrits dans un module pur prenant `(db, groupId, bornes)` en paramètres, et `getClotureReport` est réécrit par-dessus en comptant les listes. Sans cette bascule, la même règle métier existerait en deux SQL divergeables, et l'export finirait par contredire la page.

Cette bascule corrige au passage un écart réel : la requête actuelle de `/cloture` ne filtre pas `obsolete_at`, donc une écriture dont l'unique justificatif a été remplacé compte comme justifiée. Les chiffres de `/cloture` peuvent légèrement augmenter après ce chantier — c'est une correction, pas une régression.

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
