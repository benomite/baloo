# Plan d'exécution — workflows internes au groupe (complétion P2)

Plan détaillé du chantier qui complète la phase 2 ([`roadmap.md`](roadmap.md)) en outillant les **4 workflows internes** que le groupe utilisera au quotidien. Tant que ces workflows ne sont pas livrés, le critère de succès P2 ("≥2 chefs d'unité actifs, ≥1 parent qui consulte") n'est pas atteignable : la P2 a livré l'infra (auth multi-user, rôles, vues scopées, blob, email) mais aucune **page de soumission self-service** pour les non-trésoriers.

Ce document est un plan d'exécution, pas un ADR. Les décisions structurelles prises pendant son exécution donneront lieu à des ADRs séparés.

---

## État d'avancement (2026-04-29)

| Chantier | Statut | Notes |
|---|---|---|
| 0.1 Hiérarchie de rôles V2 | ✅ fait | ADR-019 acté. Migration BDD idempotente dans `web/src/lib/auth/schema.ts` (`cotresorier→tresorier`, `chef_unite→chef`). Helpers `ADMIN_ROLES/COMPTA_ROLES/SUBMIT_ROLES` exportés depuis `lib/auth/access.ts`. Sidebar et `set-user-role.ts` adaptés. Typecheck + build OK. |
| 0.2 Flux d'invitation par email | ✅ fait | ADR-020 acté. Service `lib/services/invitations.ts`, helper email `lib/email/transport.ts`, template `lib/email/invitation.ts`, API `/api/invitations` (admin only), page `/admin/invitations`, lien sidebar. 2 emails (bienvenue + magic link standard). Pas de table dédiée, on s'appuie sur `users.email_verified IS NULL`. |
| 1 Dépôt de justif libre + relance | ✅ fait | Table `depots_justificatifs` créée via `ensureDepotsSchema` (sans CHECK, valeurs validées côté code). Service `lib/services/depots.ts` (create/list/get/reject/attach + listCandidateEcritures). Page `/depot` (form mobile-first, file required) pour `tresorier/RG/chef/equipier`. Page `/depots` (file de traitement, modale rapprocher avec candidats matching ±10%/±15j, modale rejeter avec motif) pour admin. Bouton "Relancer" sur les écritures sans justif (admin) → email Resend via helper `email/relance.ts`. Pas de pré-remplissage `?ecriture_hint` au MVP. |
| 2 Demande de remboursement self-service | ⏳ à faire | Audit `/remboursements/nouveau` à faire avant. |
| 3 Demande d'abandon de frais | ⏳ à faire | Symétrique du 2. |
| 4 Gestion de la caisse | ⏳ à faire | Audit `/caisse` à faire avant. |

---

## 0. Liste des workflows

Dans l'ordre énoncé par le trésorier (et l'ordre d'implémentation retenu) :

1. **Dépôt de justificatif libre** — n'importe quel user invité dépose un justif (photo + métadonnées) ; le trésorier rapproche ensuite avec une écriture. Pas de relance auto au MVP — bouton manuel "relancer cette personne" sur les écritures sans justif.
2. **Demande de remboursement** — un bénévole / parent saisit sa demande et joint son justif depuis son espace.
3. **Demande d'abandon de frais** — même mécanique que le remboursement, mais pas de paiement à la sortie.
4. **Gestion de la caisse** — entrées / sorties / solde. Audit de l'existant, complétion UI.

---

## 1. Pré-requis transverses (chantier 0)

Ces décisions concernent les 4 workflows. À traiter **avant** le chantier 1.

### 1.1. Hiérarchie de rôles cible

Modifie **`users.role` uniquement** — `personnes.role_groupe` (annuaire SGDF, valeurs `co-rg`, `secretaire_principal`, `responsable_matos`, etc.) **n'est PAS touché**.

| Rôle (`users.role`) | Accès | Actions |
|---|---|---|
| `tresorier` | Tout | Tout (pilote la compta). Multi-instance possible — un groupe peut avoir 2 trésoriers. |
| `RG` (responsable de groupe) | Tout | Idem `tresorier` au MVP. Cible : valide les actions critiques (remboursements > seuil, abandons, etc.) — non implémenté à ce stade |
| `chef` (anciennement `chef_unite`) | Compta de son unité (filtre `scope_unite_id`) | Voir budget unité, déposer justifs, faire demandes |
| `equipier` (nouveau) | Aucune compta | Déposer justifs, faire demandes |
| `parent` | Espace `/moi` uniquement (reçus fiscaux, dons) | Lecture seule |

**Règle transverse** : tous les rôles authentifiés peuvent déposer un justif libre et faire une demande de remboursement / abandon (sauf `parent` qui ne fait que consulter).

**Travaux** :
- Migration `users.role` :
  - `cotresorier` → `tresorier` (le concept de cotrésorier disparaît — un groupe a juste plusieurs trésoriers)
  - `chef_unite` → `chef`
- Ajouter `RG` et `equipier` aux valeurs valides côté code (le type est `string` dans `web/src/lib/context.ts`, pas de CHECK constraint en BDD).
- Mettre à jour la matrice de droits dans `web/src/lib/auth/access.ts` : `tresorier` et `RG` sont admins ; `chef` voit son unité ; `equipier` n'a accès qu'aux pages de soumission ; `parent` reste sur `/moi`.
- Mettre à jour la sidebar (`web/src/components/layout/sidebar.tsx`) avec les nouveaux noms.
- ADR à créer : **ADR-019 — hiérarchie de rôles V2**.

### 1.2. Flux d'invitation par email

ADR-016 acte qu'Auth.js refuse `createUser` — seuls les users en BDD peuvent se connecter. C'était volontaire pour le MVP P2 (un seul trésorier en BDD). Pour ouvrir aux autres rôles à grande échelle, il faut un **flux applicatif d'invitation** (séparé d'Auth.js).

**Travaux** :
- Page `/admin/invitations` (réservée `tresorier` / `RG`) : formulaire `email + rôle + scope_unite_id?`.
- Service `invitations` : crée un user `statut='invite'` + insère un `verification_token` Auth.js + envoie l'email magic link via Resend.
- Au premier login, l'user passe en `statut='actif'`.
- Modèle minimal — pas de table `invitations` séparée : on réutilise `users` + `verification_tokens`. Le statut `invite` suffit à distinguer.
- ADR à créer : **ADR-020 — flux d'invitation par email**.

### 1.3. Stockage et UX des soumissions

Convention commune aux workflows 1, 2, 3 :
- Photos / PDF passent par `getStorage().put(...)` (déjà abstrait Blob/FS).
- Validation côté API : taille max, mime type whitelist (jpg/png/pdf/heic).
- UX mobile-first : la majorité des dépôts se feront depuis un téléphone (photo prise sur place).

---

## 2. Chantier 1 — Dépôt de justificatif libre + relance manuelle

**Objectif** : tout user invité peut, depuis la webapp, déposer un justif (photo + quelques champs). Le trésorier voit une file de dépôts à traiter et les rapproche avec ses écritures.

### 2.1. Modélisation

**Décision clé** : un dépôt **NE crée PAS d'écriture** au moment du dépôt. Sinon doublons garantis avec les brouillons générés par `scanDraftsFromComptaweb` au prochain rapprochement bancaire.

**Nouvelle table `depots_justificatifs`** :

```sql
CREATE TABLE depots_justificatifs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  submitted_by_user_id TEXT NOT NULL,
  titre TEXT NOT NULL,
  description TEXT,
  category_id TEXT,
  unite_id TEXT,
  amount_cents INTEGER,        -- nullable, pas toujours connu au dépôt
  date_estimee TEXT,           -- nullable (ISO YYYY-MM-DD)
  carte_id TEXT,               -- nullable, si paiement carte connu
  statut TEXT NOT NULL DEFAULT 'a_traiter',  -- a_traiter | rattache | rejete
  ecriture_id TEXT,            -- rempli quand statut=rattache
  motif_rejet TEXT,            -- rempli quand statut=rejete
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Le **fichier** reste dans `justificatifs` avec `entity_type='depot'` + `entity_id=depot.id`. Au moment du rapprochement (statut → `rattache`), on update le justif : `entity_type='ecriture'` + `entity_id=ecriture.id`. Comme ça les services existants (`overview`, `ecritures.has_justificatif`) continuent de marcher sans modification.

### 2.2. UI

- **Page `/depot`** (tous rôles authentifiés sauf `parent`) :
  - Formulaire : titre, description, catégorie (select), unité (select, pré-rempli pour `chef`), montant (optionnel), date (optionnelle), carte (optionnel).
  - Upload photo / PDF.
  - À la soumission : crée un `depots_justificatifs` + attache le file.
- **Page `/depots`** (côté trésorier) :
  - Liste des dépôts `a_traiter`, triés par date.
  - Pour chaque dépôt : actions "rapprocher avec écriture" (modale qui propose les brouillons existants matchant montant/date/unité), "créer écriture from scratch" (préremplit avec les données du dépôt), "rejeter" (motif obligatoire).

### 2.3. Relance manuelle

- **Page `/ecritures`** côté trésorier : déjà existante. Filtre "sans justif" déjà implicite via `overview` ; ajouter un filtre explicite côté liste.
- **Bouton "relancer"** sur une écriture sans justif : modale "à qui envoyer ?" (saisie libre d'un user du groupe ou d'un email externe) → envoi mail Resend avec lien vers `/depot?ecriture_hint=<id>` (préremplit la modale du dépôt avec le contexte connu).

### 2.4. Critère de succès chantier 1

- Un `equipier` peut, depuis son téléphone, ouvrir `/depot`, prendre une photo, remplir 4 champs et soumettre en moins de 30 secondes.
- Le trésorier voit le dépôt dans `/depots` immédiatement après et peut le rapprocher en 2 clics avec un brouillon Comptaweb existant.
- Un mail de relance manuelle arrive bien au destinataire avec un lien préremplir.

---

## 3. Chantier 2 — Demande de remboursement self-service

**Objectif** : un bénévole saisit sa demande de remboursement depuis `/moi/nouveau-remboursement` (ou équivalent), joint son justif, et suit le statut.

### 3.1. État de l'existant

- Service `remboursements.ts` ✅ et API ✅ existent.
- Page `/remboursements/nouveau` existe (à auditer — orientée trésorier ou demandeur ?).
- Cycle de vie acté côté skill `remboursement` : `demandé → validé → payé` (ou `refusé`).
- Lien user↔demandeur : `personnes.user_id` (déjà prévu, à câbler).

### 3.2. Travaux

- Auditer la page `/remboursements/nouveau` ; si elle est orientée trésorier, créer une variante `/moi/remboursements/nouveau` pour les demandeurs (champs simplifiés, pas de mode de paiement choisi côté demandeur).
- Filtre `personnes.user_id = currentUser.id` dans `services/remboursements.ts` quand le user n'est pas trésorier/RG.
- Page `/moi` enrichie : section "mes remboursements" avec statut (badge) et historique.
- Notifs email aux étapes clés : demande créée (au trésorier), validée (au demandeur), payée (au demandeur), refusée (au demandeur, avec motif). Toutes via Resend.

### 3.3. Critère de succès chantier 2

- Un `chef` qui a avancé 23 € de tickets de métro saisit sa demande en moins d'une minute, joint la photo des tickets, et reçoit un email à chaque transition de statut.
- Le trésorier voit la demande dans `/remboursements` immédiatement.

---

## 4. Chantier 3 — Demande d'abandon de frais

**Objectif** : même mécanique que le remboursement, mais pas de paiement (le bénévole renonce au remboursement → reçu fiscal de don à la place).

### 4.1. État de l'existant

- Service `abandons.ts` ✅ et API ✅ existent.
- Aucune page UI dédiée.

### 4.2. Travaux

Symétrique du chantier 2. Le formulaire est presque identique à un remboursement — l'utilisateur coche une case "j'abandonne ce frais" qui route vers `abandons` plutôt que `remboursements`. À évaluer : faire un seul formulaire unifié avec une bascule, ou deux flux séparés ?

**Décision à trancher en début de chantier** : formulaire unifié vs séparé. Argument unifié : un bénévole peut hésiter au moment de remplir. Argument séparé : la sortie comptable et fiscale est différente (reçu fiscal vs paiement), donc autant le marquer dans le funnel.

### 4.3. Critère de succès chantier 3

- Un parent organisateur peut transformer sa demande de remboursement en abandon en un clic.
- Le reçu fiscal annuel se génère depuis la table `abandons` (cible plus lointaine, hors de ce chantier).

---

## 5. Chantier 4 — Gestion de la caisse

**Objectif** : auditer la page `/caisse` existante, compléter ce qui manque.

### 5.1. État de l'existant

- Service `caisse.ts` ✅, API ✅, page `(app)/caisse` ✅ existent.

### 5.2. Travaux

À cadrer après audit. À première vue probable :
- Affichage du solde courant.
- Saisie d'une entrée (ex. quête, contribution) ou d'une sortie (ex. achat goûter).
- Lien optionnel vers une activité ou une unité.
- Cohérence avec le rapprochement Comptaweb (la caisse n'a pas de ligne bancaire → les écritures `caisse` ne tombent pas dans le scan drafts).

### 5.3. Critère de succès chantier 4

- Le trésorier d'unité peut, depuis son téléphone, saisir l'entrée de 12 € de quête au camp et voir le solde mis à jour.

---

## 6. Décisions à trancher pendant l'exécution

- **ADR-019** — hiérarchie de rôles V2 (chantier 0).
- **ADR-020** — flux d'invitation par email (chantier 0).
- **Formulaire remboursement vs abandon : unifié ou séparé** (chantier 3, début).
- **Notifs email** : conventions de templates, sender, opt-out — pas d'ADR mais à formaliser dans `web/src/lib/email/` au premier usage.

## 7. Ordre et dépendances

```
Chantier 0 (rôles + invitations)
        │
        ├──► Chantier 1 (dépôt justif + relance)
        │
        ├──► Chantier 2 (remboursement self-service)
        │            │
        │            └──► Chantier 3 (abandon, partage UI/notifs avec 2)
        │
        └──► Chantier 4 (caisse, indépendant)
```

Chantier 0 est bloquant. Les chantiers 1, 2, 4 peuvent ensuite avancer en parallèle ; le 3 dépend du 2.

## 8. Critère de succès global

Repris de la roadmap P2 : sur 1 mois, ≥2 chefs d'unité utilisent activement la webapp pour leurs justifs et ≥1 parent consulte son espace, sans relance.

Avec ces 4 workflows livrés, le critère devient atteignable. Sans eux, la P2 n'est pas terminée même si toute la plomberie est en place.
