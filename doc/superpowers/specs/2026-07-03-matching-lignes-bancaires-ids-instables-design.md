# Matching des lignes bancaires robuste aux ids Comptaweb instables

**Date** : 2026-07-03
**Statut** : design validé

## Problème (cas concret DEGOMME)

La ligne bancaire `#19105752` (DEGOMME +45 €, CAMP FARFA, 23/06, non rapprochée) **ne crée pas de draft** dans Baloo.

Cause : `ECR-2026-389` (GABORIAUD +45 €, `recette`, `status='mirror'`, validée dans CW) porte `ligne_bancaire_id = 19105752` — le **même id**. Comptaweb a d'abord attribué `19105752` à GABORIAUD (validé → sorti des non-rapprochées), puis **réutilisé le même id** pour la nouvelle ligne DEGOMME.

`scanDraftsFromComptaweb` reconnaît « ligne déjà traitée » via un index `bySousIndex` **keyé sur `(ligne_bancaire_id, sous_index)` uniquement**, sans comparer le contenu. Il trouve `ECR-389` sous `19105752 / sous_index null`, la compte comme *existant*, et **n'crée pas** le draft DEGOMME.

C'est l'autre face du bug GABORIAUD (arbitrage à répétition) : les ids de lignes bancaires CW **ne sont pas des clés de transaction stables**.

## Cause racine

`ligne_bancaire_id` (issu du `releve_a_rapprocher[<id>]` de la page rapprochement) est traité comme un identifiant stable de transaction. Il ne l'est pas : CW le recycle entre transactions au fil des rapprochements.

## Design

Rendre la reconnaissance « déjà représentée » **robuste à l'instabilité des ids** en matchant le **contenu**, pas seulement l'id.

Dans `scanDraftsFromComptaweb` :

1. **`findLineDrafts`** (charge les écritures d'une ligne) renvoie en plus `amount_cents`, `libelle_origine`, `description`.
2. Le candidat courant `c` est « déjà représenté » **seulement s'il existe, sous ce `ligne_bancaire_id`, une écriture avec** :
   - même `sous_index` (`c.sousLigneIndex`),
   - même montant (`amount_cents == amountAbs`),
   - **et** même libellé brut : `libelle_origine == c.libelProposal` **OU** `description == c.libelProposal`.
   
   Sinon → l'id a été recyclé (autre transaction) → on **crée** le draft.

Le libellé brut figé `libelle_origine` (posé à la création = `libelProposal`) est la clé fiable : il survit au renommage « titre parlant » (qui ne change que `description`) et distingue deux transactions de même montant/date.

### Sûreté (invariants préservés)

- **DEGOMME** : sous `19105752`, seule `ECR-389` (libellé GABORIAUD ≠ DEGOMME) → pas de match contenu → draft DEGOMME créé. ✅
- **Re-scan DEGOMME** : le draft créé a `libelle_origine == libelProposal` → match → *existant*, pas de doublon. ✅
- **Anti-doublon `findCwAccountedTwin`** (paiement déjà en CW, même contenu, `comptaweb_ecriture_id` non nul) : inchangé, continue de skipper. ✅
- **`planStaleLineDrafts`** (retrait des sous-lignes obsolètes) : keyé par `sous_index`, non affecté — `ECR-389` (mirror) et le draft DEGOMME (sous_index null tous deux, tous deux « canoniques » quand la ligne n'a pas de sous-ligne) restent. Aucune suppression à tort. ✅
- **Self-heal de type** : trouve toujours le bon draft (par contenu). ✅

### Portée

Contenue à `drafts.ts` (`findLineDrafts` + le lookup `bySousIndex` remplacé par un match contenu). **Aucune migration** (`libelle_origine` existe déjà). Le grain reste `(ligne, sous_index)` scopé par `ligne_bancaire_id`, enrichi du contenu.

### Hors périmètre

- Ne pas « nettoyer » le `ligne_bancaire_id` périmé de `ECR-389` (association devenue caduque mais inoffensive : l'écriture est validée, elle n'a plus besoin du lien).
- Ne pas remplacer `ligne_bancaire_id` par un hash de contenu partout (refonte trop large ; le fix local suffit au symptôme).

## Tests (TDD)

1. **Id recyclé** : une écriture `mirror` de contenu A sous `ligne_id` X + une ligne bancaire de contenu B (même X, même sous_index) → le draft B est **créé** (`crees == 1`).
2. **Pas de doublon au re-scan** : après création de B, un second scan (B toujours présent) → **pas** de nouveau draft (`crees == 0`, `existants == 1`).
3. **Vraie re-visite** : écriture de contenu A sous `ligne_id` X + ligne bancaire de contenu A (même X) → *existant*, pas de création.
4. **Anti-doublon CW inchangé** : jumeau `findCwAccountedTwin` (même contenu, `comptaweb_ecriture_id` non nul) → skippé (`doublons == 1`).
