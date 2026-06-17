# Rôle « membre » unifié, camps réservés aux chefs, home didactique

**Date :** 2026-06-17
**Statut :** Design validé, prêt pour plan d'implémentation

## Problème

Trois ajustements de droits + onboarding, demandés par le trésorier :

1. Un **équipier ne doit plus voir les camps**.
2. Les **camps sont réservés aux chefs (chacun pour sa seule unité)** et aux admins (tresorier/RG, vue globale).
3. **Équipier et parent ont le même usage** : on les fusionne en un seul rôle, limité à **3 process — dépôt, remboursement, abandon**.
4. Ajouter une **page d'accueil didactique** pour les membres et les chefs : expliquer ce que fait Baloo et les orienter vers le bon endroit.

## État existant (pré-feature)

- **Rôles applicatifs** : `tresorier`, `RG`, `chef`, `equipier`, `parent` (TEXT libre dans `users.role`, pas de CHECK SQL — validation en code, ADR-019). Type `UserRole` dans `web/src/lib/context.ts`, `VALID_ROLES` dans `web/src/lib/services/invitations.ts` + `web/src/lib/actions/invitations.ts`.
- **Gardes d'accès** (`web/src/lib/auth/access.ts`) : `requireAdmin` (tresorier/RG), `requireComptaAccess` (+chef), `requireCanSubmit` (+equipier), `requireNotParent` (redirige parent → `/moi`), `requireRole` (générique).
- **`parent`** : lecture seule, voit uniquement la home `/` (« Mes reçus »), ne peut rien soumettre (`canSubmit` l'exclut).
- **`equipier`** : peut déposer/rembourser/abandonner **et voit les camps** — sans `scope_unite_id`, donc **tous** les camps du groupe.
- **`chef`** : `scope_unite_id` renseigné → `listCamps`/`getCamp`, `listEcritures`, `listRemboursements` filtrent déjà sur sa seule unité.
- **Camps** : table `camps` avec `unite_id` NOT NULL ; `listCamps(ctx)`/`getCamp(ctx)` (`web/src/lib/services/camps.ts`) filtrent par `ctx.scopeUniteId`. Page `/camps` gardée par `requireNotParent` (donc equipier inclus).
- **Navigation** (`web/src/components/layout/nav-config.ts`) : `DESKTOP_GROUPS`, `MOBILE_TABS`, filtrage `visibleItemsForRole` / `resolveNavItem` ; constante `SUBMITTERS = ['tresorier','RG','chef','equipier']` ; overrides `parentHref`/`parentLabel` ; tab mobile « Mes reçus » réservé `['parent']`. Tests : `web/src/components/layout/nav-config.test.ts`.
- **Home** (`web/src/app/(app)/page.tsx`) : admin → redirect `/ecritures` ; chef/equipier → redirect `/depot` ; parent → rend la home « Mes reçus » (`MyDemandsSection`, `QuickActions` masqués). `isWelcomeBannerDismissed()` lu.

## Décisions validées

| Sujet | Décision |
|---|---|
| Fusion equipier+parent | **Nouveau rôle unique `membre`** (migration des deux → `membre`). Distinction parent/équipier conservée dans l'annuaire (`personnes.role_groupe`), non touchée. |
| Droits du membre | **Dépôt, remboursement, abandon** uniquement. Le membre **peut soumettre** (fin du read-only parent). Pas de camps, pas de compta. |
| Camps | **Chef (sa seule unité)** + **admin (tous)**. Retirés au membre. |
| Home `/` | **Home didactique par rôle** (remplace la redirection) pour membre + chef. Admin toujours redirigé `/ecritures`. |
| Périmètre chef | **Inchangé** hormis les camps (déjà OK). |

## Modèle de rôles cible

Rôles applicatifs : **`tresorier`, `RG`, `chef`, `membre`**.

- Migration idempotente dans `ensureAuthSchema` (`web/src/lib/auth/schema.ts`), même pattern que l'existant `UPDATE users SET role='chef' WHERE role='chef_unite'`. **Aucun DELETE** :
  ```sql
  UPDATE users SET role = 'membre' WHERE role IN ('equipier', 'parent');
  ```
- MAJ des références : `UserRole` (`context.ts`), `VALID_ROLES` (service + action invitations), `ROLE_OPTIONS` (page `/admin/invitations`), `ROLE_LABELS` + `ROLE_ACTIONS` (`web/src/lib/email/invitation.ts`) — ajout `membre`, retrait `equipier`/`parent`.
- **Filet de sécurité** : les ensembles de rôles d'accès (cf. ci-dessous) incluent `equipier` et `parent` comme **alias de `membre`**, pour éviter tout lock-out si la migration n'a pas encore tourné au cold start.

## Périmètre d'accès

| Page / process | membre | chef | tresorier / RG |
|---|:--:|:--:|:--:|
| `/` (home didactique) | ✅ | ✅ | → redirigé `/ecritures` |
| `/depot` | ✅ | ✅ (scope unité) | ✅ |
| `/remboursements` + `/remboursements/nouveau` | ✅ (ses demandes) | ✅ (scope) | ✅ (tous) |
| `/abandons` | ✅ | ✅ (scope) | ✅ |
| `/camps` | ❌ | ✅ (sa seule unité) | ✅ (tous) |
| `/ecritures`, `/caisse`, `/inbox`, `/budgets`, `/depots`, `/import` | ❌ | ❌ | ✅ |
| `/admin/*` | ❌ | ❌ | ✅ |

### Changements dans `web/src/lib/auth/access.ts`

- `requireCanSubmit` : ensemble cible **`['tresorier','RG','chef','membre']`** (+ alias legacy `equipier`,`parent`). Posé sur `/depot`, `/remboursements`, `/remboursements/nouveau`, `/abandons`.
- **Nouveau `requireCampsAccess(role)`** : autorise **`['tresorier','RG','chef']`**, redirige `/` sinon. Posé sur `/camps` (page + détail `/camps/[id]`).
- `/ecritures` : passe de `requireNotParent` à **`requireComptaAccess`** (`['tresorier','RG','chef']`) → retire le membre. *Resserrement volontaire : aujourd'hui l'`equipier` pouvait y accéder par URL.*
- `requireNotParent` : **supprimé** (obsolète une fois `parent` disparu) ; chaque page qui l'utilisait reçoit la garde adéquate (`requireCanSubmit` pour les process, `requireCampsAccess` pour camps, `requireComptaAccess` pour ecritures).
- `requireAdmin`, `requireComptaAccess`, `requireRole` : inchangés (sauf que `requireComptaAccess` est désormais aussi utilisé par `/ecritures`).

Le filtrage par `scope_unite_id` (chef → sa seule unité) reste inchangé dans les services (`camps.ts`, `ecritures.ts`, `remboursements.ts`).

## Navigation (`web/src/components/layout/nav-config.ts`)

- Renommer la constante `SUBMITTERS` → `MEMBERS = ['tresorier','RG','chef','membre']` (+ alias legacy si besoin de robustesse) et mettre à jour ses usages.
- Item **Camps** : `roles = ['tresorier','RG','chef']` (retire le membre).
- Supprimer les overrides `parentHref` / `parentLabel` (item remboursements) et le tab mobile « Mes reçus » (`roles: ['parent']`). Le membre voit « Mes demandes » → `/remboursements` ; l'admin garde « Remboursements ».
- `resolveNavItem` : retirer la branche `role === 'parent'`. `isAdminRole` inchangé.

## Home didactique (`web/src/app/(app)/page.tsx`)

- Logique de routage : admin (`tresorier`/`RG`) → `redirect('/ecritures')` (inchangé). **chef & membre → rendent la home didactique** (plus de redirect `/depot`). Plus de cas `parent`.
- Contenu :
  - En-tête « Bonjour {prénom} » + 1-2 phrases expliquant Baloo (« dépose tes justificatifs, demande tes remboursements, déclare un abandon de frais »). Pas d'engagement de délai (cf. conventions UI).
  - **Cartes-raccourcis** (icône + titre + 1 ligne, lien vers le process) :
    - membre : *Déposer un justificatif* (`/depot`) · *Demander un remboursement* (`/remboursements/nouveau`) · *Déclarer un abandon* (`/abandons`).
    - chef : les 3 ci-dessus **+** *Mes camps* (`/camps`).
  - Bloc **« Mes dernières demandes »** : réutilise `MyDemandsSection` (ses remboursements/abandons récents + statut), alimenté par `listRemboursements`/`listAbandons` scopés `submittedByUserId = ctx.userId`.
  - `WelcomeBanner` conservé (masquable via `isWelcomeBannerDismissed()`).

Esquisse :
```
┌───────────────────────────────────────┐
│ Bonjour Marie                          │
│ Baloo t'aide à gérer tes frais…        │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ │📎 Déposer│ │💶 Rembt │ │🎁 Abandon│   │  (+ 🏕 Camps si chef)
│ └─────────┘ └─────────┘ └─────────┘    │
│ Mes dernières demandes                  │
│ • REM-123  42,50 € — à traiter          │
└───────────────────────────────────────┘
```

## Tests

- `access.ts` (fonctions pures, sans BDD) : `requireCampsAccess` autorise tresorier/RG/chef et redirige membre ; `requireCanSubmit` autorise membre ; `requireComptaAccess` (posé sur ecritures) refuse membre. Vérifier les alias legacy (`equipier`/`parent` traités comme membre).
- `nav-config.test.ts` : membre ne voit pas Camps ; membre voit Déposer/Demandes/Abandons ; plus de tab « Mes reçus » ; plus d'override parent.
- Migration : test (BDD mémoire) que `equipier` et `parent` deviennent `membre` après `ensureAuthSchema`.
- Home : composant de cartes — membre = 3 cartes, chef = 4 cartes (test léger sur la sélection des cartes par rôle).

## Hors scope (YAGNI)

- Pas de changement du périmètre **chef** au-delà des camps (il garde son accès actuel et son filtrage par unité).
- Pas de refonte du filtrage `scope_unite_id` (déjà en place).
- Pas de suppression de la valeur `parent`/`equipier` au niveau `personnes.role_groupe` (annuaire SGDF) — seul le rôle **applicatif** (`users.role`) est fusionné.
- Pas de nouvelle capacité camps pour le chef (le scoping par unité existe déjà) — on retire seulement l'accès au membre.
