# Statut de synchronisation « qui parle »

**Date** : 2026-07-04
**Statut** : design validé

## Problème

Le bouton de statut de sync (`sync-status-button.tsx`, footer sidebar, admin only) a deux défauts terrain :

1. **Peu lisible / mal placé** : petit texte gris tout en bas de la sidebar, loin de la page Écritures où la fraîcheur de sync compte.
2. **« Ça échoue et je sais pas pourquoi »** : le message d'erreur complet existe pourtant déjà (`sync_runs.error_message` + `/admin/errors`), mais il n'est exposé **que dans le tooltip `title`** du bouton — invisible en PWA/mobile (pas de hover), non découvrable. Le libellé visible reste le générique « Échec sync — réessayer ».

Pire : un **timeout Vercel** (maxDuration 60 s, la lambda est tuée) laisse le run bloqué en `status='running'` sans jamais écrire `error_message` ni passer `failed`. Après 60 s (`RUNNING_LOCK_MS`), `is_running=false` mais `last_run.status='running'` → l'UI l'affiche en « stale » (warning), pas en échec. Une part des « échecs » mystérieux vient de là et n'est aujourd'hui **pas** signalée comme telle.

## Périmètre retenu

**A + B** (validé) : popover de diagnostic au clic + traduction des erreurs techniques en messages actionnables. Purement côté affichage — `error_message` est déjà en base, aucun changement de service, aucune migration. C (indicateur dans le header Écritures) et D (cosmétique) hors périmètre pour ce lot.

## A. Popover de diagnostic au clic

Aujourd'hui : clic = relance immédiate (`runSync(true)`), le « pourquoi » est planqué dans le tooltip.

Demain : le clic ouvre une **popover ancrée au bouton** dès qu'il y a quelque chose à expliquer (états **échec** et **interrompue**). Sur les états nominaux (OK / stale simple / running), le clic garde le comportement actuel (relance / rien) — pas de popover inutile.

Contenu de la popover :

```
┌────────────────────────────────────┐
│ ⚠ <titre parlant>                  │
│ il y a 12 min                      │
│                                    │
│ <conseil actionnable>              │
│                                    │
│ [ <action ctx.> ]   [ Réessayer ]  │
│                    Voir le journal │
└────────────────────────────────────┘
```

- **Quand** : `finished_at` (ou `started_at` si le run est resté bloqué) en relatif.
- **Titre + conseil** : sortie de `describeSyncError` (cf. B).
- **Action contextuelle** (optionnelle) : ex. bouton/lien *Reconnecter Comptaweb* → `/admin/parametres` quand la cause est session/creds.
- **Réessayer** : `runSync(true)` (comportement actuel du clic).
- **Voir le journal** : lien discret → `/admin/errors`.
- Fermeture : clic dehors + Échap. Composant client, pas de dépendance nouvelle (popover maison légère, cohérente avec l'existant).

Le message brut reste toujours atteignable : affiché en petit dans le cas *fallback*, et via le journal dans tous les cas.

## B. Traduction des erreurs — `describeSyncError`

Module **pur, testable**, sans dépendance : `web/src/components/sync/describe-sync-error.ts`.

```ts
export type SyncErrorAction = { label: string; href: string };
export type SyncErrorInfo = {
  title: string;        // titre parlant, ex. « Session Comptaweb expirée »
  advice: string;       // conseil actionnable
  action?: SyncErrorAction; // bouton/lien contextuel optionnel
  showRaw: boolean;     // afficher le message brut (cas fallback)
};

// error: le last_run (status + error_message), OU un signal d'erreur client réseau.
export function describeSyncError(input: {
  status: 'failed' | 'running' | 'error-client';
  errorMessage: string | null;
}): SyncErrorInfo;
```

Taxonomie (matching sur `errorMessage`, insensible à la casse, sur des sous-chaînes stables tirées des vrais `throw` du code) :

| Cas détecté (indices dans `errorMessage`) | title | advice | action |
|---|---|---|---|
| `status==='running'` (run bloqué, lock expiré) | « Synchronisation interrompue » | « La dernière sync s'est arrêtée avant la fin (Comptaweb a mis trop de temps). Réessaie. » | — |
| `status==='error-client'` (fetch réseau côté client) | « Connexion perdue » | « Impossible de joindre Baloo. Vérifie ta connexion, puis réessaie. » | — |
| `Aucun identifiant Comptaweb` \| `sont requis` | « Comptaweb non configuré » | « Renseigne tes identifiants Comptaweb pour synchroniser. » | Paramètres → `/admin/parametres` |
| `ComptawebSessionExpiredError` \| `session` | « Session Comptaweb expirée » | « Reconnecte-toi à Comptaweb pour relancer la sync. » | Reconnecter → `/admin/parametres` |
| `Keycloak` \| `MFA` \| `login` \| `redirection` (auth) | « Connexion Comptaweb refusée » | « Comptaweb a refusé la connexion. Vérifie tes identifiants. » | Paramètres → `/admin/parametres` |
| `structure Comptaweb` \| `introuvable` \| `layout` \| `a changé` | « Comptaweb a changé » | « La page Comptaweb a changé de structure. Signale-le, une mise à jour de Baloo est nécessaire. » | — |
| `HTTP 5` (5xx) | « Comptaweb indisponible » | « Comptaweb a renvoyé une erreur. Réessaie dans un moment. » | — |
| fallback (inconnu) | « Échec de synchronisation » | « Une erreur inattendue s'est produite. » + message brut affiché | Voir le journal (via lien existant) ; `showRaw = true` |

Ordre d'évaluation : du plus spécifique au plus générique ; premier match gagne. Le fallback couvre tout le reste sans jamais masquer l'info (message brut + journal).

### Nouvel état « interrompue » dans le bouton

`sync-status-button.tsx` gagne une branche : quand `last_run.status === 'running'` **et** `is_running === false` (le lock 60 s a expiré → run mort en vol), afficher un état **avertissement/échec** « Sync interrompue » qui ouvre la popover (via `describeSyncError({status:'running'})`). Aujourd'hui ce cas tombe silencieusement en « stale ».

## Portée & fichiers

- **Créé** : `web/src/components/sync/describe-sync-error.ts` (pur) + son test.
- **Créé** : petit composant popover (ex. `sync-status-popover.tsx`) ou popover inline dans le bouton — au choix de l'implémentation, léger, sans lib externe.
- **Modifié** : `web/src/components/sync/sync-status-button.tsx` (branche « interrompue », clic → popover sur états explicables, câblage `describeSyncError`).
- Inchangé : services, routes API, hook `use-sync-status.ts` (le `status` remonte déjà `last_run.status` + `error_message` + `is_running`). À vérifier à l'implémentation que `error_message` et `is_running` sont bien exposés au client — sinon micro-ajout au type client (déjà présents d'après la cartographie).

Zéro migration, zéro changement de contrat serveur.

## Tests (TDD)

`describeSyncError` — un test par ligne de la taxonomie :
1. run bloqué (`status:'running'`) → titre « interrompue », pas d'action.
2. erreur réseau client (`status:'error-client'`) → « Connexion perdue ».
3. `errorMessage` contient « Aucun identifiant Comptaweb » → « non configuré » + action `/admin/parametres`.
4. `ComptawebSessionExpiredError` → « expirée » + action reconnexion.
5. indice Keycloak/MFA → « refusée » + action paramètres.
6. « structure Comptaweb a peut-être changé » → « a changé », pas d'action, pas de showRaw.
7. « HTTP 500 » → « indisponible ».
8. message inconnu → fallback, `showRaw=true`, message brut préservé.
9. `errorMessage=null` + `status:'failed'` → fallback propre (pas de crash).

Popover / bouton : vérifiés visuellement (composant client) ; la logique testable est extraite dans `describeSyncError`.

## Hors périmètre

- C — indicateur de sync dans le header de la page Écritures (report éventuel plus tard).
- D — cosmétique (« Synced » → « Sync OK », bannière active).
- Fixer la cause racine des timeouts CW (maxDuration) : ici on **explique** l'interruption, on ne la supprime pas.
- Historique multi-runs dans la popover (le journal `/admin/errors` couvre déjà ça).
