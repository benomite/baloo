# Frais kilométriques dans les demandes de remboursement

**Date :** 2026-06-17
**Statut :** Design validé, prêt pour plan d'implémentation

## Problème

Certaines demandes de remboursement concernent des **frais kilométriques** : on ne saisit pas un montant mais un **nombre de kilomètres**, et le montant se calcule au **taux du km** (actuellement 0,354 €/km, barème SGDF qui change régulièrement). Le justificatif attendu est la **carte grise** du véhicule. La fiche officielle SGDF gère ça via des colonnes par type de frais (transport avec justif / transport km / hébergement / autre), jugées peu pratiques — on garde un modèle par ligne plus simple.

## État existant (pré-feature)

- **`remboursement_lignes`** (`web/src/lib/auth/schema.ts`) : `id, remboursement_id, date_depense, amount_cents, nature, notes, created_at`. Pas de notion de type.
- **`remboursements`** (entête, `web/src/lib/db/business-schema.ts`) : `total_cents` = somme des `amount_cents` des lignes, recalculé par `recalcTotal` (`web/src/lib/services/remboursements.ts`).
- **Création** : `createRemboursement` + `addLigne` (`web/src/lib/services/remboursements.ts`) ; action `web/src/lib/actions/remboursements/create.ts`. L'édition remplace toutes les lignes (delete + reinsert).
- **Formulaire** : `web/src/components/rembs/remboursement-form.tsx` — état `Ligne { key, date, montant (string), nature }`, grille `date | nature | montant`, bouton ajouter/retirer.
- **Justificatifs** : liés à la demande via `(entity_type='remboursement', entity_id)` ; au moins 1 requis à la création. RIB via `entity_type='remboursement_rib'`.
- **PDF** : `web/src/lib/pdf/feuille-remboursement.ts` génère la feuille signée.
- **Groupe** : table `groupes` (`web/src/lib/db/business-schema.ts`), service `updateGroupe` (`web/src/lib/services/groupes.ts`). Pas de page de paramètres web (admin = `/admin/errors`, `/admin/invitations`).

## Décisions validées

| Sujet | Décision |
|---|---|
| Modèle | Une **ligne typée** `depense` \| `km` (pas les 4 colonnes officielles). Nature = texte libre. |
| Taux | **Réglage au niveau du groupe**, **figé sur chaque ligne km** au moment de la demande. |
| Précision taux | Stocké en **millièmes d'euro** (354 = 0,354 €/km) — les centimes ne suffisent pas. |
| Édition du taux | **Petit champ admin** (nouvelle page `/admin/parametres`, trésorier). |
| Distance | **1 décimale** acceptée (ex. 12,5 km). |
| Carte grise | **Justificatif normal** (pas de traçage dédié) + **rappel** dans le formulaire quand une ligne km existe. |
| Calcul | Montant km calculé **côté serveur** (le client n'envoie que les km). |

## Données

### `remboursement_lignes` — colonnes ajoutées (migration idempotente)
Ajout via `ensureAuthSchema` (`ALTER TABLE ADD COLUMN` nullable + backfill, pattern Turso du projet ; pas de CHECK SQL) :
- `type TEXT` — `'depense'` (défaut) | `'km'`. Migration : `ALTER ... ADD COLUMN type TEXT DEFAULT 'depense'` puis `UPDATE remboursement_lignes SET type='depense' WHERE type IS NULL`.
- `distance_km_dixiemes INTEGER` — distance en dixièmes de km (125 = 12,5 km), nullable, rempli pour les lignes km. (Entier → pas de flottant, 1 décimale.)
- `taux_km_millicents INTEGER` — taux figé (millièmes d'euro), nullable, rempli pour les lignes km.
- `amount_cents` (existant) — montant : saisi pour `depense`, **calculé** pour `km`.

### `groupes` — colonne ajoutée
- `taux_km_millicents INTEGER` — taux courant du groupe. Migration `ALTER ... ADD COLUMN` + backfill `UPDATE groupes SET taux_km_millicents = 354 WHERE taux_km_millicents IS NULL` (défaut 0,354 €/km).

`total_cents` de l'entête = somme des `amount_cents` (inchangé, `recalcTotal` ne change pas).

## Calcul du montant km

Fonction pure (testable, sans BDD), p.ex. `web/src/lib/services/km.ts`. Unités : distance en **dixièmes de km** (`distance_km_dixiemes`), taux en **millièmes d'euro/km** (`taux_km_millicents`).

**Formule :** `amount_cents = Math.round(distance_km_dixiemes * taux_km_millicents / 100)`

Dérivation : montant € = `(distance_km_dixiemes / 10) km × (taux_km_millicents / 1000) €/km` ; en centimes = `× 100` = `distance_km_dixiemes × taux_km_millicents / 100`.

Exemples :
- 100 km = 1000 dixièmes, taux 354 → `1000 × 354 / 100 = 3540` cents = **35,40 €**.
- 12,5 km = 125 dixièmes, taux 354 → `125 × 354 / 100 = 442,5 → round = 443` cents = **4,43 €** (12,5 × 0,354 = 4,425).

Le calcul utilise le **taux courant du groupe** lu côté serveur à la création/édition, figé dans `taux_km_millicents` de la ligne. (À l'édition d'une demande non finalisée, re-snapshot au taux courant — acceptable car les éditions sont pré-validation et les changements de taux rares.)

## Formulaire (`remboursement-form.tsx`)

- L'état `Ligne` gagne `type: 'depense' | 'km'` et `km: string` (nb de km saisi). Le formulaire reçoit le **taux courant du groupe** (prop) pour l'aperçu.
- Chaque ligne : sélecteur **Dépense / Kilométrique**.
  - `depense` : `date · nature · montant` (inchangé).
  - `km` : `date · nature · nb km` → montant **calculé en lecture seule** affiché (« 120 km × 0,354 € = 42,48 € »).
- Total en direct = somme (dépenses saisies + km calculés avec le taux courant).
- Si ≥ 1 ligne km : bandeau **« Pense à joindre la carte grise du véhicule »** (rappel ; la carte grise reste un justif normal dans le lot).
- Soumission : pour les lignes km, on envoie `type=km`, `km`, `nature`, `date` (PAS le montant — recalculé serveur).

Esquisse :
```
Type         Date    Nature                 Montant / km
[Dépense ▾]  09/05   Courses week-end        37,04 €            [x]
[Km      ▾]  09/05   Trajet aller-retour     120 km → 42,48 €   [x]
                                             (taux 0,354 €/km)
⚠ Pense à joindre la carte grise du véhicule
                                    Total :  79,52 €
```

## Service & action

- `CreateLigneInput` / le payload de lignes gagnent `type`, `distance_km_dixiemes`, et (pour km) le calcul du montant. `addLigne` calcule `amount_cents` pour les lignes km à partir du taux groupe figé.
- `createRemboursement` / l'édition (`web/src/lib/actions/remboursements/create.ts` + service) : lisent le taux courant du groupe, figent `taux_km_millicents` et calculent `amount_cents` pour chaque ligne km, côté serveur. Le `total_cents` reste recalculé par `recalcTotal`.
- Le taux est lu via le service `groupes` (`getGroupe`/équivalent) ; jamais reçu du client.

## Réglage du taux (admin)

- Nouvelle page **`/admin/parametres`** (garde `requireAdmin`) avec un champ « Taux kilométrique (€/km) » pré-rempli depuis `groupes.taux_km_millicents`, enregistré via `updateGroupe`. Affiche la valeur courante (format `0,354 €`).
- Saisie en euros (`0,354`) → conversion en millièmes (354) au stockage.

## Affichage détail + PDF

- Détail (`web/src/app/(app)/remboursements/[id]/page.tsx`) et édition : ligne km rendue « 120 km × 0,354 € = 42,48 € » ; ligne dépense inchangée.
- PDF (`web/src/lib/pdf/feuille-remboursement.ts`) : montant des lignes km dans la colonne « TRANSPORT Nb kilomètres » (avec le nb de km), dépenses dans la colonne dépense/autre ; rappel du taux du km en bas (comme la fiche officielle).

## Validation

- Ligne `km` : `distance_km_dixiemes > 0` requis ; le montant est calculé (un montant saisi est ignoré).
- Ligne `depense` : `amount_cents > 0` requis (inchangé).
- « Au moins 1 justificatif » : inchangé — pour une demande 100 % km, la carte grise jointe satisfait la règle.

## Tests

- **Calcul km** (fonction pure) : 100 km/0,354 → 35,40 € ; 12,5 km/0,354 → 4,43 € (arrondi) ; taux alternatif.
- **Snapshot du taux** : une ligne km stocke le taux du groupe au moment du save ; changer le taux groupe ne modifie pas les lignes existantes.
- **Total mixte** : dépense + km additionnés dans `total_cents`.
- **Migration** : colonnes ajoutées ; lignes existantes restent `type='depense'` ; `groupes.taux_km_millicents` backfillé à 354.
- **Service create/edit** : lignes km calculées côté serveur (montant client ignoré).

## Hors scope (YAGNI)

- Pas de catégorisation transport/hébergement/autre par ligne (type `depense`/`km` suffit).
- Pas de traçage dédié de la carte grise (justif normal + rappel).
- Pas d'historique des taux (un taux courant par groupe ; le figeage par ligne suffit pour l'historique des demandes).
- Pas de barème multi-puissance fiscale (un seul taux ; le barème SGDF est unique).
