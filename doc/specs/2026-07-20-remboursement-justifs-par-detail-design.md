# Remboursements — tri des détails par date + justifs rattachés aux détails

- **Date** : 2026-07-20
- **Statut** : validé (brainstorming), à implémenter
- **Scope** : trésorier uniquement, page détail d'une demande de remboursement + formulaire

## Problème

Une demande de remboursement a plusieurs lignes de détail (`remboursement_lignes`). Deux manques côté trésorier :

1. **Tri par date** : dans le formulaire de saisie/édition, les lignes restent dans l'ordre d'ajout. Sur la page d'affichage, elles sont triées par date croissante mais le tri est figé (server component, pas d'interaction).
2. **Suivi des justificatifs par détail** : un justificatif se rattache aujourd'hui à la demande **entière** (`entity_type='remboursement'`), jamais à une ligne. Le trésorier ne peut pas voir, ligne par ligne, si chaque détail a bien son justificatif.

## Décisions de cadrage

- Tri par date : **formulaire ET affichage** (tri interactif à l'affichage).
- Rattachement justif : on **réutilise les justifs déjà déposés** sur la demande (pas de nouvel upload par ligne). Le trésorier **affecte** un justif existant à une ou plusieurs lignes.
- **Trésorier seulement** : le formulaire du demandeur ne change pas (justifs déposés en vrac sur la demande). L'affectation aux lignes se fait sur la page détail côté trésorier.

## Bloc 1 — Tri par date des détails

### Formulaire (`web/src/components/rembs/remboursement-form.tsx`)

Les lignes s'affichent réordonnées par `date_depense` croissante (au rendu et après chaque ajout/modification de date), au lieu de l'ordre de saisie. Pas de drag & drop. Le tri est un tri d'affichage : l'ordre stocké importe peu puisque `listLignes` re-trie déjà en SQL.

- Tri secondaire : `created_at` / index d'insertion pour stabilité quand deux lignes ont la même date.
- Une ligne en cours de saisie avec date vide reste en fin de liste (ne pas la faire sauter pendant la frappe).

### Page d'affichage (`web/src/app/(app)/remboursements/[id]/page.tsx`)

La table « Détail des dépenses » (server component figé, `page.tsx:190-233`) est extraite dans un **composant client** dédié (`web/src/components/rembs/detail-depenses-table.tsx`) recevant les lignes + les rattachements justifs en props.

- En-têtes cliquables : **Date** (↑↓) et **Montant** (↑↓). Défaut = date croissante (comportement actuel préservé).
- État de tri local (`useState`), pas d'URL/query param.
- Le rendu des lignes km (distance × taux) est conservé tel quel.

## Bloc 2 — Modèle de données : justif ↔ ligne

### Prérequis : rendre les `id` de lignes stables

Aujourd'hui la server action d'édition (`web/src/lib/actions/remboursements/update.ts:102-112`) **supprime toutes les lignes puis les ré-insère** (`deleteLigne` + `addLigne`). Conséquence : les `id` changent à chaque édition → tout rattachement justif→ligne serait cassé, et c'est contraire à la règle « jamais de DELETE en masse » (CLAUDE.md) dès lors que les lignes portent des données liées.

**Refonte en réconciliation** dans le service (`web/src/lib/services/remboursements.ts`), nouvelle fonction `reconcileLignes(remboursementId, lignesVoulues[])` :

1. Charger les lignes existantes.
2. Pour chaque ligne voulue portant un `id` existant → **UPDATE** (date, montant, nature, notes, colonnes km).
3. Ligne voulue sans `id` (ou `id` inconnu) → **INSERT** (nouvel `id`).
4. Ligne existante absente des voulues → **DELETE** de cette ligne uniquement (et de ses rattachements justif via la table de liaison, voir plus bas). Ce DELETE ciblé d'une ligne retirée par l'utilisateur est légitime (équivalent au `deleteLigne` unitaire déjà exposé).
5. `recalcTotal`.

Le formulaire d'édition doit donc **transmettre l'`id` de chaque ligne existante** (champ caché) pour permettre le match. Les nouvelles lignes n'ont pas d'`id`.

> Note : `computeRemboursementHash` trie les lignes par `id` — préserver les `id` ne change pas le hash tant que les données métier sont identiques. À vérifier en test (une édition « sans changement » ne doit pas invalider une signature existante).

### Table de liaison (plusieurs-à-plusieurs)

Un justif peut couvrir plusieurs lignes ; une ligne peut avoir plusieurs justifs.

Posée dans `web/src/lib/auth/schema.ts` (convention ALTER/CREATE tardif du repo), avec son index :

```sql
CREATE TABLE IF NOT EXISTS remboursement_ligne_justificatifs (
  ligne_id        TEXT NOT NULL REFERENCES remboursement_lignes(id),
  justificatif_id TEXT NOT NULL REFERENCES justificatifs(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (ligne_id, justificatif_id)
);
CREATE INDEX IF NOT EXISTS idx_rlj_ligne ON remboursement_ligne_justificatifs(ligne_id);
CREATE INDEX IF NOT EXISTS idx_rlj_justif ON remboursement_ligne_justificatifs(justificatif_id);
```

Aucun nouvel upload : on n'affecte que des justifs déjà présents sur la demande (`entity_type='remboursement'`, `entity_id = remboursement.id`).

## Bloc 3 — Services

Dans `web/src/lib/services/remboursements.ts` (ou un module dédié `remboursement-justifs.ts` si le fichier grossit trop) :

- `listJustificatifsDemande(remboursementId)` — les justifs de la demande (existe déjà via `list_justificatifs` / la page ; réutiliser).
- `listAssignationsLignes(remboursementId)` — retourne, pour la demande, la liste `{ ligne_id, justificatif_id }` (join). Sert à alimenter les props du tableau et calculer la couverture.
- `setJustificatifLignes(justificatifId, ligneIds[])` — remplace l'ensemble des affectations d'**un** justif : insère les nouvelles paires, retire celles décochées. Garde-fous : le justif et les lignes doivent appartenir à la même demande / au même `group_id`.
- `computeCouverture(lignes, assignations)` — helper pur : nombre de lignes ayant ≥ 1 justif / total. Testable en isolation.

Suppression d'une ligne (via `reconcileLignes` étape 4) → retirer d'abord ses paires dans `remboursement_ligne_justificatifs`, puis DELETE la ligne (ordre pour éviter tout orphelin, l'app ne se repose pas sur le cascade FK).

## Bloc 4 — UI de suivi (page détail trésorier)

1. **Tableau « Détail des dépenses »** (`detail-depenses-table.tsx`) : par ligne, une pastille `✓ justif` / `⚠ manquant` + le(s) nom(s) de fichier rattaché(s) (lien de téléchargement).
2. **Liste des justifs de la demande** : sur chaque justif, un contrôle (menu / cases à cocher des lignes de la demande, libellées « date — nature — montant ») pour l'affecter à une ou plusieurs lignes. Enregistrement via server action appelant `setJustificatifLignes`.
3. **Indicateur de couverture** en tête de la section détail : « X/Y détails justifiés ».

L'affectation est réservée au trésorier (page détail dans l'espace app authentifié) ; pas de changement sur le formulaire public/demandeur.

## Hors scope

- Pas d'upload de justif par ligne (on rattache l'existant).
- Pas de changement côté demandeur.
- Pas d'outil MCP d'affectation au MVP. L'affectation étant de la donnée pure (pas de multipart), elle pourra être exposée en MCP ultérieurement (`set_justificatif_lignes`) — noté, non implémenté ici.

## Tests (TDD)

- `reconcileLignes` : préserve les `id` des lignes inchangées ; UPDATE en place ; INSERT des nouvelles ; DELETE ciblé des retirées ; `recalcTotal` correct ; une édition sans changement ne modifie pas `computeRemboursementHash`.
- `setJustificatifLignes` : ajoute/retire les bonnes paires ; refuse un justif ou une ligne d'une autre demande / d'un autre groupe.
- `computeCouverture` : cas 0 ligne, toutes justifiées, partiellement, justif couvrant plusieurs lignes.
- Suppression d'une ligne rattachée : les paires de liaison sont retirées, pas d'orphelin.

## Fichiers touchés (prévisionnel)

- `web/src/lib/auth/schema.ts` — nouvelle table + index.
- `web/src/lib/services/remboursements.ts` (+ éventuel `remboursement-justifs.ts`) — `reconcileLignes`, `listAssignationsLignes`, `setJustificatifLignes`, `computeCouverture`.
- `web/src/lib/actions/remboursements/update.ts` — bascule DELETE+reinsert → `reconcileLignes`.
- `web/src/components/rembs/remboursement-form.tsx` — tri d'affichage par date + transmission des `id` de lignes.
- `web/src/components/rembs/detail-depenses-table.tsx` — **nouveau** composant client (tri interactif + pastilles justif).
- `web/src/app/(app)/remboursements/[id]/page.tsx` — intègre le composant client, charge les assignations, contrôle d'affectation sur la liste des justifs.
