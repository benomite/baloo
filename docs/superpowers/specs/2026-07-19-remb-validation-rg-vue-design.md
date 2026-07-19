# Vue « À valider » pour les RG — design

Date : 2026-07-19
Statut : validé (brainstorming)

## Problème

La mécanique de validation d'un remboursement par un Responsable de Groupe (RG)
existe déjà et tourne en prod :

- workflow de statuts `a_traiter → valide_tresorier → valide_rg → virement_effectue → termine`
  (`web/src/lib/types.ts`), avec garde de transition par rôle
  (`web/src/lib/services/remboursements-transitions.ts`) ;
- signature électronique chaînée à chaque validation (ADR-023) ;
- bouton « Valider (RG) » sur la fiche détail `/remboursements/[id]`, visible
  si `status === 'valide_tresorier'` et rôle RG.

Ce qui manque, c'est **l'expérience RG** : il n'y a pas de vue « voici ce que tu
dois signer », et le lien d'accès direct d'un RG invité l'amène au formulaire de
saisie (`/remboursements/nouveau`) au lieu de sa file de validation. Un RG doit
donc connaître l'URL filtrée à la main.

Objectif : rendre la validation RG **partageable et immédiate**, sans toucher au
workflow ni au modèle de données. Aucune nouvelle colonne, aucune migration.

## Solution — option légère

### 1. Onglet « À valider » sur `/remboursements`

Nouvel onglet dans la barre `TabLink` existante (`web/src/app/(app)/remboursements/page.tsx`),
à côté de « Toutes » et « À rattacher ». Il est **contextuel au rôle** de
l'utilisateur connecté, en réutilisant la logique de transition déjà en place :

| Rôle connecté | Statut listé      | Sens                          |
|---------------|-------------------|-------------------------------|
| `tresorier`   | `a_traiter`       | ce qu'il doit valider en 1er  |
| `RG`          | `valide_tresorier`| ce qu'il doit contresigner    |
| autres        | onglet masqué     | ils ne valident rien          |

Implémentation :

- l'onglet cible `?tab=a-valider` ;
- la page traduit ce tab en filtre statut selon `ctx.role` :
  `validateStatus = ctx.role === 'RG' ? 'valide_tresorier' : ctx.role === 'tresorier' ? 'a_traiter' : null` ;
- si `validateStatus` est `null`, l'onglet n'est pas rendu ;
- le filtre passe par le `status` déjà accepté par `listRemboursements`
  (`web/src/lib/queries/remboursements.ts` → service). Un seul statut suffit,
  pas besoin de filtre multi-statuts.
- **Badge compteur** sur l'onglet (nombre en attente pour ce rôle), calqué sur
  le compteur `unlinkedCount` existant. Bonus quasi gratuit, on le met.

L'onglet « Toutes » reste le défaut. Les trois onglets (`Toutes`,
`À valider`, `À rattacher`) sont mutuellement exclusifs à l'affichage `active`.

### 2. Atterrissage du lien d'accès direct RG

Aujourd'hui `createInvitation` (`web/src/lib/services/invitations.ts`) passe un
`callbackUrl` **hardcodé** `/remboursements/nouveau` à `generateInviteLink`
(idem `resendInvitation`). La route publique `web/src/app/i/[token]/route.ts`
lit déjà le `callbackUrl` **stocké** (`resolved.callbackUrl`) — donc rien à y
changer.

Modification : rendre le `callbackUrl` dépendant du rôle de l'invitation.

- invitation de rôle **RG** → `/remboursements?tab=a-valider` ;
- tout autre rôle (`membre`, `chef`, `tresorier`) → `/remboursements/nouveau`
  **inchangé** (on ne casse pas le flow de soumission des parents/membres).

À faire aux deux points où `generateInviteLink` est appelé avec un
`callbackUrl` : `createInvitation` (rôle = `input.role`, ou `effectiveRole` si
user réutilisé) et `resendInvitation` (rôle = `user.role`). Extraire un petit
helper pur `callbackUrlForRole(role): string` pour éviter la duplication.

### 3. Hors scope (non touché)

- Le workflow de statuts, la signature RG, le bouton « Valider (RG) », les
  transitions : tout existe, reste tel quel.
- La colonne `validate_token` (vestige import Airtable) : **non exploitée**.
  Réservée à une éventuelle option « DocuSign » ultérieure (lien profond par
  remboursement, sans compte).

## Fichiers touchés

- `web/src/app/(app)/remboursements/page.tsx` — onglet « À valider » + filtre
  statut contextuel + badge compteur.
- `web/src/lib/services/invitations.ts` — `callbackUrl` selon rôle (helper
  `callbackUrlForRole`), aux deux appels de `generateInviteLink`.

Potentiellement : rien côté `queries`/`services` remboursements (le filtre
`status` existe déjà) ni côté route `i/[token]` (déjà générique).

## Tests

- Module pur `callbackUrlForRole` : RG → `/remboursements?tab=a-valider`,
  autres → `/remboursements/nouveau`. Test unitaire vitest sans BDD.
- Vérif manuelle : onglet visible + bon compteur pour un compte trésorier vs
  un compte RG ; onglet absent pour un compte membre.

## Risques

- Faible. Réutilise l'existant. Le seul point de vigilance : ne pas régresser
  l'atterrissage `/nouveau` des rôles non-RG (couvert par le test du helper).
