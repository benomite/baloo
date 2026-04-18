# Skill : remboursement

Process générique SGDF pour traiter une demande de remboursement de frais avancés par un bénévole (chef, membre du bureau, parent).

## Quand l'utiliser

Un bénévole a avancé des frais personnels pour une activité ou un besoin du groupe et demande à être remboursé.

## Informations nécessaires

| Champ | Obligatoire | Source habituelle |
|---|---|---|
| Demandeur (prénom + nom) | oui | demande directe |
| Montant TTC | oui | justificatif |
| Date de la dépense | oui | justificatif |
| Nature de la dépense | oui | demandeur (transport, intendance, matériel, etc.) |
| Unité / activité concernée | oui | demandeur |
| Justificatif (ticket, facture, screenshot) | oui | demandeur |
| Mode de remboursement souhaité (virement, espèces) | oui | demandeur |
| RIB du demandeur (si virement) | si virement | demandeur |

## Statuts

Cycle de vie d'un remboursement :

```
demandé → validé → payé
             ↘ refusé
```

- **demandé** : la demande est enregistrée, pas encore validée par le trésorier.
- **validé** : le trésorier a vérifié le justificatif et accepte le remboursement.
- **refusé** : le remboursement est refusé (justificatif insuffisant, hors budget, etc.). Motif à noter.
- **payé** : le virement ou le paiement en espèces a été effectué.

## Étapes

### 1. Recueillir les informations

Demander à l'utilisateur les infos manquantes parmi celles listées ci-dessus. Si un justificatif est fourni (image, PDF), en extraire le montant et la date pour pré-remplir.

### 2. Vérifier la cohérence

- Le montant du justificatif correspond à ce qui est demandé.
- La nature de la dépense est compatible avec le budget de l'unité / activité.
- Le demandeur est bien identifié (pas d'ambiguïté de nom).

Si incohérence, signaler et demander clarification avant de continuer.

### 3. Enregistrer la demande

Créer une entrée dans le fichier d'écritures du groupe avec le statut `demandé`. L'identifiant est attribué séquentiellement (`RBT-<ANNÉE>-<NNN>`).

### 4. Valider ou refuser

Le trésorier décide. Si validé → passer au statut `validé`. Si refusé → noter le motif et clore.

### 5. Effectuer le paiement

Le trésorier effectue le virement (ou remet les espèces). Mettre à jour le statut à `payé` avec la date de paiement.

### 6. Saisir dans Compta-Web

Le remboursement doit être saisi dans Compta-Web (source de vérité comptable). Mettre à jour le champ `Saisie Compta-Web` une fois fait.

### 7. Confirmer au demandeur

Informer le demandeur que le remboursement a été effectué (ou refusé, avec motif).

## Pièges connus

- **Tickets de caisse illisibles** : demander une photo nette ou un relevé bancaire en complément.
- **TVA / TTC** : en asso loi 1901 non assujettie à la TVA, on rembourse le TTC. Ne pas se laisser piéger par un montant HT sur une facture pro.
- **Oubli du RIB** : fréquent. Prévoir une relance standardisée.
- **Dépense ancienne** : si la dépense date de plus de 3 mois, vérifier que le budget de l'exercice est encore ouvert.
- **Double demande** : vérifier qu'un remboursement pour le même montant / même date / même demandeur n'existe pas déjà.
