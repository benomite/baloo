# Inbox — relier les écritures de virement aux remboursements

Date : 2026-06-01
Statut : design validé, à implémenter

## Problème

Certaines écritures bancaires sont des **virements de remboursement** (le
groupe rembourse un chef / parent qui a avancé des frais). Leur
justificatif n'est pas un dépôt de ticket : c'est la **feuille de
remboursement** déjà générée par Baloo. Aujourd'hui :

1. **Inbox** : ces écritures tombent dans « écritures sans justif » sans
   aucun moyen de les relier à un remboursement (l'inbox ne connaît que
   le matching écriture ↔ dépôt). Elles n'en sortent donc jamais.
2. **Lien existant non terminal** : `linkRemboursementToEcriture` /
   `setRembsEcritureLink` ne posent que `remboursements.ecriture_id`.
   L'écriture liée reste `justif_attendu=1` sans justif attaché → elle
   reste indéfiniment affichée comme « justif manquant » (inbox +
   `/ecritures`).

Doctrine métier : **tout remboursement doit, à terme, être relié à son
écriture comptable de virement** — c'est la vraie fin du process.

## Existant (ne pas refaire)

- `remboursements.ecriture_id` : champ de lien (nullable).
- Fiche détail remboursement : `EcritureLinkCard` (sidebar) — sélecteur
  des écritures candidates (montant exact, ±365 j) + lier / délier.
- Page `/remboursements` : onglet « À rattacher » + compteur
  (`virement_effectue`/`termine` sans `ecriture_id`), colonne « Écriture »
  par ligne (lien / « à rattacher » ambre / —).
- Inbox : `computeAutoSuggestions` (écriture ↔ dépôt) extrait dans le
  module pur `lib/queries/inbox-matching.ts` ; rejet « Pas ça » via
  `inbox_suggestion_rejets` + service `lib/services/inbox-rejets.ts`.

## Décisions validées

- **Surface inbox** : étendre la section « Suggestions automatiques »
  existante (pas de section dédiée). Les paires écriture ↔ remboursement
  apparaissent à côté des écriture ↔ dépôt, avec un badge distinctif.
- **« Justifiée » = lien logique** : une écriture liée à un remboursement
  compte comme justifiée *partout*, sans copier de fichier ni flag.
  Réversible (délier ⇒ réapparaît). Aucun DELETE.
- **1 clic, pas d'auto-link silencieux** pour les remboursements (trop
  conséquent ; collisions de montant fréquentes — ex. plusieurs 24 €).
- **« Pas ça » généralisé** : le rejet couvre aussi les paires
  écriture ↔ remboursement.

## Architecture

### 1. Matching — module pur `lib/queries/inbox-matching.ts`

Ajouter, à côté de `computeAutoSuggestions` :

- Type `RembCandidate` (sous-ensemble remboursement utile à l'inbox :
  `id`, `demandeur`, `amount_cents`, `date_paiement`, `date_depense`,
  `status`, `unite_code`).
- `export function computeRembSuggestions(ecritures, rembs, rejectedKeys): RembSuggestion[]`
  - Glouton 1:1, comme `computeAutoSuggestions`.
  - Critère : `Math.abs(ecr.amount_cents) === remb.amount_cents` (montant
    **exact**) ET `daysBetween(ecr.date_ecriture, COALESCE(date_paiement,
    date_depense)) ≤ 15`.
  - Meilleur match = date la plus proche.
  - Skip si `rejectedKeys.has(rejetPairKey(ecr.id, 'remboursement', remb.id))`.
- `RembSuggestion = { ecriture: InboxEcriture; remboursement: RembCandidate; date_diff_days: number }`.

Généraliser la clé de rejet pour porter le type de cible :

```ts
export function rejetPairKey(
  ecritureId: string,
  targetKind: 'depot' | 'remboursement',
  targetId: string,
): string {
  return `${ecritureId}::${targetKind}:${targetId}`;
}
```

Mettre à jour les appels existants de `rejetPairKey` (dépôt) en passant
`'depot'`.

### 2. Rejet généralisé — `inbox_suggestion_rejets`

Schéma cible (lazy-init `ensureInboxRejetsSchema`) :

```
inbox_suggestion_rejets(
  id, group_id,
  ecriture_id,
  target_kind TEXT NOT NULL DEFAULT 'depot',   -- 'depot' | 'remboursement'
  target_id   TEXT NOT NULL,                    -- depot_id ou remboursement_id
  rejected_by_user_id, created_at,
  UNIQUE (group_id, ecriture_id, target_kind, target_id)
)
```

Migration douce dans `ensureInboxRejetsSchema` (table créée le 2026-06-01,
quelques lignes en prod) :
- Si l'ancienne colonne `depot_id` existe : `ALTER TABLE ADD COLUMN
  target_kind TEXT DEFAULT 'depot'` ; `ADD COLUMN target_id TEXT` ;
  `UPDATE ... SET target_id = depot_id WHERE target_id IS NULL`. On laisse
  `depot_id` en place (legacy, plus écrit). Pas de DROP (SQLite).
- `UNIQUE` historique `(group_id, ecriture_id, depot_id)` conservé sans
  gêne ; le nouvel index `UNIQUE (group_id, ecriture_id, target_kind,
  target_id)` est ajouté `IF NOT EXISTS`.

Service `lib/services/inbox-rejets.ts` :
- `rejectSuggestion(ctx, ecritureId, targetKind, targetId)` — INSERT OR
  IGNORE sur la forme générique.
- `loadRejectedPairKeys(groupId)` — `SELECT ecriture_id, target_kind,
  target_id` → Set de `rejetPairKey(...)`.

### 3. L'écriture quitte l'inbox une fois liée

- `lib/queries/inbox.ts` `listInboxItems` + `countInboxItems` : ajouter à
  la clause écritures orphelines
  `AND NOT EXISTS (SELECT 1 FROM remboursements r WHERE r.ecriture_id = e.id)`.
- `lib/services/ecritures.ts` : la logique « justif manquant »
  (`e.type='depense' AND e.justif_attendu=1 AND NOT has_justificatif`)
  doit aussi exclure les écritures liées depuis un remboursement.
  Exposer un champ calculé `remboursement_id` (le RBT qui pointe
  l'écriture) pour le badge.
- `/ecritures` (liste) + fiche écriture : badge **« justifiée par
  RBT-xxx »** avec lien `/remboursements/<id>` quand `remboursement_id`
  est défini.

### 4. Données inbox — `listInboxItems`

- Charger les remboursements à rattacher :
  `status IN ('virement_effectue','termine') AND ecriture_id IS NULL`.
- Calculer `rembSuggestions = computeRembSuggestions(ecrituresAll,
  rembsARattacher, rejectedKeys)`.
- Retirer les écritures utilisées par une suggestion rembs des colonnes
  orphelines (comme pour les suggestions dépôt) — `usedEcr` inclut les
  deux types.
- `InboxData` : nouveau champ `rembSuggestions: RembSuggestion[]` **ou**
  une liste `suggestions` unifiée en union discriminée. → **Union
  discriminée** retenue (un seul rendu, tri par date) :
  `type InboxSuggestionItem = ({ kind: 'depot' } & InboxSuggestion) | ({ kind: 'remboursement' } & RembSuggestion)`.

### 5. UI inbox — `app/(app)/inbox/page.tsx`

- `SuggestionsSection` rend l'union. Côté droit :
  - `kind='depot'` → `JustifSummary` (inchangé).
  - `kind='remboursement'` → résumé remboursement (demandeur, montant,
    badge **« Remboursement »**, lien vers `/remboursements/<id>`).
- Boutons par ligne :
  - `kind='depot'` → formulaires existants (`lierEcritureJustif` +
    `rejeterSuggestionInbox`).
  - `kind='remboursement'` → `lierEcritureRemboursement` (nouvelle action)
    + `rejeterSuggestionInbox` généralisée (champs `target_kind`,
    `target_id`).
- `key` de liste : `${kind}-${ecriture.id}-${targetId}`.

### 6. Actions — `lib/actions/inbox.ts`

- `lierEcritureRemboursement(formData)` : lit `ecriture_id`,
  `remboursement_id` ; appelle `setRembsEcritureLink(groupId,
  remboursementId, ecritureId)` ; `revalidatePath('/inbox')`,
  `/remboursements/<id>`, `/ecritures/<id>` ; redirect avec flash
  `rbt_linked`.
- `rejeterSuggestionInbox` généralisée : lit `target_kind` (défaut
  `'depot'` pour rétro-compat du form dépôt) + `target_id` (ou `depot_id`
  legacy) ; appelle `rejectSuggestion(ctx, ecritureId, targetKind,
  targetId)`.

## Flux

1. CW pousse la ligne bancaire du virement → écriture orpheline (dépense,
   sans justif).
2. Inbox : `computeRembSuggestions` apparie l'écriture avec le
   remboursement viré (montant exact, date ±15 j) → suggestion
   `kind='remboursement'`.
3. Trésorier clique **Lier** → `setRembsEcritureLink` pose
   `ecriture_id`.
4. Au rendu suivant : l'écriture est exclue des orphelines (lien logique),
   la suggestion disparaît, `/ecritures` affiche « justifiée par RBT-xxx »,
   `/remboursements` la montre liée. Process bouclé.
5. Si la suggestion est fausse (autre rembt de même montant) → **Pas ça**
   enregistre le rejet `(ecriture, 'remboursement', rbtId)` ; le suivant
   est proposé.

## Gestion d'erreurs

- `lierEcritureRemboursement` réutilise les garde-fous de
  `setRembsEcritureLink` (écriture introuvable, déjà liée à un autre
  rembt) → redirect inbox avec `error`.
- Rôle non admin → redirect `error` (comme les autres actions inbox).
- `date_paiement` nul (théoriquement impossible en `virement_effectue`,
  mais data historique) → fallback `date_depense` via COALESCE.

## Tests

- `inbox-matching` (pur, sans stack auth) :
  - `computeRembSuggestions` apparie montant exact + date ≤ 15 j.
  - rejette > 15 j, montant non exact.
  - une paire rejetée n'est plus proposée ; le rembt suivant de même
    montant l'est.
  - glouton 1:1 (un rembt déjà apparié n'est pas réutilisé).
- `inbox-rejets` (généralisation) : clé `depot` vs `remboursement`
  distinctes ; backfill migration.
- Garder verts les tests inbox existants (signatures, suggestions dépôt).

## Hors scope (suite éventuelle)

- Auto-link silencieux des remboursements ultra-évidents.
- Surfacer les remboursements à rattacher qui n'ont **aucune** écriture
  candidate (ex. virement pas encore importé) — déjà visible via
  `/remboursements?unlinked=1`.
