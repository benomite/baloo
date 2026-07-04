# Partager un dépôt (justif) sur une 2ᵉ écriture — paiement scindé

**Date** : 2026-07-04
**Statut** : design validé

## Problème

Un paiement passé en 2 fois (souci carte) produit **2 écritures** bancaires mais **1 seul justificatif**, déposé via `/depot`. Aujourd'hui, lier un dépôt à une écriture le fait passer en `statut='rattache'` et **déplace** physiquement le pointeur de ses fichiers (`justificatifs.entity_type/entity_id` : `depot` → `ecriture`). Deux verrous empêchent alors de le réutiliser :
1. `attachDepotToEcriture` refuse tout dépôt `statut !== 'a_traiter'` (`depots.ts`).
2. Le pool de suggestions ne charge que les dépôts `a_traiter`.

Aucune contrainte SQL n'est en jeu — c'est purement logiciel. Le trésorier ne peut donc pas rattacher le même justif à la 2ᵉ écriture.

## Fait technique clé

Le **blob** d'un justif est stocké à un chemin figé à la création : `depot/<depotId>/<jusId>-<filename>` (cf. `attachJustificatif`). Le rattachement ne met à jour que `entity_type`/`entity_id` de la ligne `justificatifs`, **jamais `file_path`** ni le blob. Donc les fichiers d'un dépôt restent identifiables par `file_path LIKE 'depot/<depotId>/%'` **même après avoir été rattachés à une écriture**. C'est la clé fiable pour retrouver « les fichiers de ce dépôt ».

## Design (minimal, sans schéma)

Décisions validées : **héritage justif + imputation**, déclenché **depuis l'écriture**.

### Service — `shareDepotToEcriture({ groupId }, depotId, ecritureId)`
Dans `web/src/lib/services/depots.ts`. Additif : il **n'altère pas** le dépôt (ni `statut`, ni `ecriture_id` — le lien principal vers l'écriture A reste intact).

1. `ensureDepotsSchema()`.
2. Charge le dépôt (scopé `group_id`) : `statut, ecriture_id, titre, category_id, unite_id, carte_id, activite_id`. Introuvable → throw.
3. Charge l'écriture cible (scopée `group_id`) : `id, status`. Introuvable → throw.
4. **Fichiers source** : `SELECT id, file_path, original_filename, mime_type FROM justificatifs WHERE group_id = ? AND file_path LIKE 'depot/' || ? || '/%'` (paramètre = `depotId`). Précis, immunisé contre la migration. Aucun fichier → throw (« Ce dépôt n'a aucun justificatif à partager »).
5. **Copie** (partage du blob) : pour chaque fichier source **absent** de l'écriture cible (garde d'idempotence : pas déjà une ligne `justificatifs` avec ce `file_path` + `entity_type='ecriture'` + `entity_id=ecritureId`), INSERT une **nouvelle** ligne `justificatifs` : nouvel `id` (`nextId('JUS')`), même `group_id`, **même `file_path`** (blob partagé, pas de ré-upload), même `original_filename`, même `mime_type`, `entity_type='ecriture'`, `entity_id=ecritureId`, `uploaded_at=now`. Compte les fichiers copiés.
6. **Héritage imputation + titre** sur l'écriture cible **si `status='draft'`**, exactement comme `attachDepotToEcriture` (COALESCE, n'écrase jamais une valeur saisie) : `category_id`, `unite_id`, `carte_id`, `activite_id` ; puis titre (`description = ?` seulement si `description = libelle_origine`).
7. Retourne `{ copied: number }`.

**Préservation** : aucune donnée détruite, aucune FK mise à NULL, aucun DELETE. On n'ajoute que des lignes. Le dépôt et l'écriture A ne bougent pas. Conforme aux règles CLAUDE.md/AGENTS.md.

### Query picker — `listRattacheDepotsForSharing({ groupId })`
Liste les dépôts `statut='rattache'` avec, pour chacun : `id, titre, amount_cents, date_estimee`, la description de l'écriture principale (`JOIN ecritures ON ecritures.id = d.ecriture_id`), et les chemins fichiers via sous-requête `file_path LIKE 'depot/'||d.id||'/%'` (`group_concat` en `justif_paths`, `COUNT` en `justif_count`). Sert à alimenter le sélecteur et l'aperçu/téléchargement (liens `/api/justificatifs/<path>`).

### Action serveur — `shareExistingDepotToEcriture(depotId, ecritureId)`
Dans `web/src/lib/actions/depots.ts`. Garde admin (`isAdminRole`), appelle le service, `revalidatePath('/ecritures')`, renvoie `{ ok: true, copied }` ou `{ ok: false, error }`. Symétrique de `linkDepotToEcriture`.

### UI — depuis l'écriture
Un point d'entrée discret sur l'écriture (panneau inline / carte justif) : **« Rattacher un justif déjà déposé »**. Ouvre un petit sélecteur (popover/modale légère) listant les dépôts rattachés (titre, montant, écriture d'origine, aperçu fichier). Sélection → appelle l'action → toast (« Justif rattaché »), `refreshRow`. Admin only, cohérent avec la bannière de correspondance existante.

Réservé aux écritures **dépense** (une recette n'attend pas de justif), aligné sur la logique de matching existante.

## Hors périmètre (assumé)
- Pas de N:M générique : la page `/depots` continue d'afficher le dépôt sur son écriture principale (A) seulement. La 2ᵉ écriture porte le justif (copie de ligne), c'est le besoin réel.
- Pas de « délier » (aucun n'existe aujourd'hui). Retrait éventuel = chantier séparé.
- Pas de table de jointure ni de colonne `source_depot_id` (le `file_path` suffit à tracer l'origine).
- Pas de refonte de l'affichage des justifs (le mécanisme `has_justificatif` / `JustificatifsCard` fonctionne tel quel via les lignes copiées).

## Tests (TDD, service)
1. Dépôt rattaché à A, 1 fichier → `shareDepotToEcriture(D, B)` crée 1 ligne `justificatifs` sur B (même `file_path`), `copied=1`, B a le justif ; A garde le sien ; dépôt inchangé (`statut='rattache'`, `ecriture_id=A`).
2. Idempotence : 2ᵉ appel identique → `copied=0`, pas de doublon de ligne sur B.
3. Héritage imputation : B est un draft aux champs vides → hérite `category_id`/`unite_id`/`activite_id`/`carte_id` du dépôt ; un champ déjà saisi sur B n'est PAS écrasé (COALESCE).
4. Héritage titre : B `description = libelle_origine` → prend `depot.titre` ; B déjà renommé → titre inchangé.
5. Écriture cible non-draft (mirror) → fichiers copiés, mais imputation/titre NON modifiés.
6. Dépôt sans fichier / introuvable / écriture introuvable → throw explicite.
7. Multi-fichiers : dépôt à 2 fichiers → 2 lignes copiées sur B.
