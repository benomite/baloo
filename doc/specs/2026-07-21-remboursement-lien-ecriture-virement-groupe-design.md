# Remboursements — lier une écriture de montant différent + virement groupé (N demandes → 1 écriture)

- **Date** : 2026-07-21
- **Statut** : validé (brainstorming), à implémenter
- **Scope** : trésorier / RG, liaison demande de remboursement ↔ écriture comptable

## Problème

Un même virement bancaire peut couvrir **plusieurs demandes** de remboursement (cas réel : 1 virement pour 5 demandes de la même personne). Aujourd'hui la liaison demande↔écriture est bloquée dans ce cas par deux verrous applicatifs (`remboursement-ecriture-link.ts`) :

1. **Montant exact** : `findEcritureCandidatesForRembs` ne propose que les écritures dont `amount_cents = total de la demande`. Un virement groupé (plus gros que chaque demande) n'apparaît jamais.
2. **Unicité** : la recherche exclut les écritures déjà liées à une autre demande (`NOT IN (...)`), et `setRembsEcritureLink` refuse (`Écriture déjà liée à la demande X.`). Impossible de lier le même virement à plusieurs demandes.

Le schéma (`remboursements.ecriture_id` FK simple, pas de `UNIQUE`) et l'affichage côté écriture (`listJustificatifsForEcriture.viaRemboursement` est déjà une **liste**) supportent déjà le plusieurs-à-un. Seuls ces deux verrous de code sont à lever.

⚠️ Terminologie : la « ventilation » ici = **rattacher N demandes au même virement**. Ça n'a **rien à voir** avec la ventilation d'écriture par catégorie (`ecritures-ventilate.ts` / `ventilation_group_id`) — on ne découpe PAS l'écriture, son montant reste le total du virement.

## Décisions de cadrage

- **Sélection** : combobox **recherchable** (réutilise `@/components/ui/combobox`), pas de filtre de montant, recherche libre sur « date · montant · libellé ».
- **Couverture** : afficher un indicateur « N demandes liées · somme / virement · reste » **côté demande ET côté écriture**.
- **Sur-lien** : si la somme des demandes liées dépasse le montant du virement → **avertissement non bloquant** (le lien reste autorisé, tolère arrondis / cas limites).

## Bloc 1 — Lever les verrous (`web/src/lib/services/remboursement-ecriture-link.ts`)

### `findEcritureCandidatesForRembs`

- Retirer le prédicat `e.amount_cents = ?` (montant exact).
- Retirer l'exclusion `e.id NOT IN (SELECT ecriture_id …)` (les écritures déjà liées ailleurs deviennent candidates).
- Conserver : `group_id`, `type='depense'`, fenêtre date ±365 j **si** `date_depense` connue (sinon pas de filtre date).
- Tri : matchs de montant proches en tête puis date décroissante — `ORDER BY ABS(e.amount_cents - ?) ASC, e.date_ecriture DESC`.
- Plafond `LIMIT 300` (la recherche du combobox fait le tri fin ; `log` si le plafond est atteint n'est pas nécessaire mais le plafond doit être conscient — cf. note plus bas).
- Chaque candidate porte en plus `linked_count` (nombre de demandes déjà liées à cette écriture) pour l'afficher dans le libellé.

### `setRembsEcritureLink`

- Retirer le contrôle `conflict` (« Écriture déjà liée à la demande X. ») → le plusieurs-à-un est autorisé.
- Conserver les vérifs d'existence (demande + écriture dans le groupe) et l'enrichissement `unite_id` en `COALESCE` sur écriture `draft` (le premier lié remplit, jamais d'écrasement — comportement inchangé).

## Bloc 2 — Couverture (helper partagé)

Dans `remboursement-ecriture-link.ts` :

```ts
export interface RembsCoverage {
  nbDemandes: number;
  sommeDemandesCents: number;    // valeur absolue, somme des totaux des demandes liées
  montantVirementCents: number;  // valeur absolue du montant de l'écriture
  resteCents: number;            // montantVirement - sommeDemandes (peut être négatif)
  depasse: boolean;              // sommeDemandes > montantVirement
}

// Pur, testable sans BDD.
export function computeRembsCoverage(montantVirementCents: number, rembsTotalsCents: number[]): RembsCoverage;

// Requête : montant de l'écriture + totaux des demandes liées, puis computeRembsCoverage.
export async function getEcritureRembsCoverage(groupId: string, ecritureId: string): Promise<RembsCoverage>;
```

- `sommeDemandesCents` = `Σ |COALESCE(total_cents, amount_cents)|` des `remboursements` dont `ecriture_id = ?`.
- Tous les montants en valeur absolue (les totaux demande sont positifs ; le signe éventuel de l'écriture ne doit pas fausser le calcul).

## Bloc 3 — UI côté demande (`web/src/components/rembs/ecriture-link-card.tsx`)

### Non liée → combobox recherchable

Le `<NativeSelect>` des candidates est remplacé par un **composant client** `web/src/components/rembs/ecriture-link-picker.tsx` :

- Reçoit `candidates` + la server action `linkRemboursementToEcriture` déjà bindée (`linkAction`).
- Rend un `<form action={linkAction}>` contenant : la `Combobox` (état local `value`), un `<input type="hidden" name="ecriture_id" value={value}>`, et le `PendingButton` (désactivé tant que rien n'est sélectionné).
- Items combobox : `value = ecriture.id`, `label = "{date} · {montant} · [{unité} · ]{libellé tronqué}[ · déjà {linked_count} liée(s)]"`.
- Le message « aucune écriture » reste, mais reformulé : plus de « montant exact » (ex. « Aucune écriture dépense trouvée dans une fenêtre de ±1 an. »).

`EcritureLinkCard` reste un server component qui charge les candidates et passe la server action bindée au picker client.

### Liée → indicateur de couverture + avertissement

`LinkedView` reçoit désormais `groupId`, appelle `getEcritureRembsCoverage(groupId, ecritureId)` et affiche sous le lien :

- « Ce virement de {montantVirement} couvre {nbDemandes} demande(s) · {sommeDemandes} · **reste {reste}** » (le « reste » masqué ou neutre si une seule demande couvre exactement).
- Si `depasse` → `Alert variant="warning"` non bloquant : « La somme des demandes liées ({sommeDemandes}) dépasse le virement ({montantVirement}). »

## Bloc 4 — UI côté écriture (`web/src/components/ecritures/justificatifs-card.tsx`)

Pour éviter toute requête supplémentaire dans les pages, on enrichit le bundle : `EcritureJustifsBundle.viaRemboursement[]` gagne `totalCents` (le total de la demande liée), renseigné dans `listJustificatifsForEcriture` (`web/src/lib/services/justificatifs.ts`).

`JustificatifsCard` (qui reçoit déjà `ecritureAmountCents`) calcule la couverture via `computeRembsCoverage(ecritureAmountCents, viaRemboursement.map(r => r.totalCents))` et, **quand il y a ≥ 1 demande liée**, affiche au-dessus de la liste des demandes un mini-récap « {n} demande(s) · {somme} / {virement} · reste {reste} », avec la même alerte non bloquante si `depasse`.

## Hors scope

- Pas de découpe de l'écriture en sous-lignes par catégorie (autre mécanisme, `ecritures-ventilate`).
- Pas de contrainte SQL ajoutée (aucune nécessaire).
- Pas d'outil MCP.
- Pas de blocage sur sur-lien (avertissement seulement).

## Tests (TDD)

- `findEcritureCandidatesForRembs` : renvoie une écriture de **montant différent** du total de la demande ; renvoie une écriture **déjà liée à une autre demande** ; respecte la fenêtre date ; tri par proximité de montant.
- `setRembsEcritureLink` : autorise le lien vers une écriture **déjà liée ailleurs** (plus d'erreur « déjà liée ») ; enrichissement `unite_id` en COALESCE inchangé.
- `computeRembsCoverage` (pur) : cas exact (reste 0, pas de dépassement), sous-couverture (reste > 0), sur-couverture (`depasse=true`, reste < 0), 0 demande.
- `getEcritureRembsCoverage` : somme des totaux des demandes liées vs montant écriture (in-memory DB).

## Fichiers touchés (prévisionnel)

- `web/src/lib/services/remboursement-ecriture-link.ts` — relâche filtres, retire conflict, `computeRembsCoverage` + `getEcritureRembsCoverage`, `linked_count` sur les candidates.
- `web/src/lib/services/justificatifs.ts` — `totalCents` sur `viaRemboursement`.
- `web/src/components/rembs/ecriture-link-card.tsx` — picker client + couverture/avertissement en vue liée.
- `web/src/components/rembs/ecriture-link-picker.tsx` — **nouveau** (combobox + input caché + submit).
- `web/src/components/ecritures/justificatifs-card.tsx` — bandeau couverture côté écriture.
- Tests services associés.
