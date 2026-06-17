# Lien d'accès direct au formulaire de remboursement

**Date :** 2026-06-17
**Statut :** Design validé, prêt pour plan d'implémentation

## Problème

Quand quelqu'un signale au trésorier un frais à se faire rembourser, le trésorier
veut, en une action : saisir l'email de la personne, créer son compte avec les bons
droits, et lui fournir un **lien déjà connecté** vers le formulaire de demande de
remboursement. Le lien doit pouvoir être **envoyé par mail** mais aussi **copié pour
être transféré via WhatsApp** (quand la personne a contacté le trésorier par ce canal).

## État existant (pré-feature)

- **Auth** : Auth.js v5, magic link email uniquement, sessions stockées **en BDD**
  (`sessions`, stratégie `database`). Le callback `signIn` refuse les emails inconnus
  (les users doivent pré-exister).
- **Invitation partielle** : `createInvitation` (`web/src/lib/actions/invitations.ts`,
  `web/src/lib/services/invitations.ts`) crée déjà le user (rôle + scope) et envoie un
  mail — mais le mail pointe vers `/login` brut, où la personne doit re-saisir son email
  et attendre un **second** mail (magic link). Pas de lien « déjà connecté ».
- **Formulaire de demande** : `/remboursements/nouveau`
  (`web/src/app/(app)/remboursements/nouveau/page.tsx`), derrière session, **interdit aux
  `parent`**.
- **Colonnes `edit_token` / `validate_token`** sur `remboursements` : définies mais
  **jamais utilisées**. Inadaptées ici (sémantique usage-unique / 30 min côté Auth.js).
- **Aucun lien copiable / partage hors mail** aujourd'hui.

## Décisions validées

| Sujet | Décision |
|---|---|
| Nature du lien | **Vrai compte + auto-connexion** : le lien crée une session complète et amène la personne connectée sur le formulaire. |
| Durée de vie | **Valide 7 jours, réutilisable** tant que non expiré (résiste aux robots d'aperçu WhatsApp/iMessage). |
| Emplacement | Enrichir la page **`/admin/invitations`** existante. |
| Rôle | **Choisi à chaque fois** (sélecteur existant conservé). Défaut attendu : `equipier`. |
| Destination du lien | `/remboursements/nouveau`. |

## Vue d'ensemble de la solution

On ajoute la brique manquante : un **lien d'auto-connexion** que `/admin/invitations`
génère en plus de créer le compte. Le formulaire d'invitation (email + rôle + scope) ne
change pas ; c'est l'après-soumission qui change :

1. Affichage du lien **copiable** (bouton Copier) pour WhatsApp.
2. Le mail d'invitation embarque ce même lien (au lieu de `/login` brut).

Le lien amène la personne **déjà connectée** sur `/remboursements/nouveau`, vaut 7 jours,
et est réutilisable.

## Données — nouvelle table

```sql
CREATE TABLE invite_links (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groupes(id),
  user_id TEXT NOT NULL REFERENCES users(id),   -- compte que le lien connecte
  token_hash TEXT NOT NULL UNIQUE,              -- SHA-256, jamais le token en clair
  callback_url TEXT NOT NULL,                   -- ex. /remboursements/nouveau
  expires_at TEXT NOT NULL,                     -- created_at + 7j
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  revoked_at TEXT
);
CREATE INDEX idx_invite_links_hash ON invite_links(token_hash);
CREATE INDEX idx_invite_links_user ON invite_links(user_id);
```

Migration ajoutée dans `ensureAuthSchema()` (`web/src/lib/auth/schema.ts`), même pattern
que `api_tokens`. Pas de `CHECK` SQL sur des champs de workflow (convention projet).

## Flux technique

### Création (action `createInvitation` enrichie)

1. Crée le user (logique actuelle, rôle + scope) **ou réutilise** le user existant si
   l'email existe déjà dans le groupe (idempotent — pas de doublon, respect règle UPSERT).
2. Génère un token aléatoire (`randomBytes`, format proche des API tokens), stocke son
   **hash** (`hashToken` de `web/src/lib/auth/api-tokens.ts`) + `callback_url =
   /remboursements/nouveau` + `expires_at = +7j` + `created_by`.
3. Renvoie le **lien en clair une seule fois** → affiché dans l'UI et injecté dans le mail.

### Ouverture du lien — nouvelle route publique `GET /i/[token]`

Route placée **hors** du groupe `(app)` (pas de session requise pour l'atteindre).

1. Hash le token reçu, retrouve la ligne `invite_links`.
2. Valide : existe / `expires_at` non dépassé / `revoked_at` nul.
3. **Mint une session BDD** pour `user_id` : insère une ligne `sessions`
   (`session_token`, `user_id`, `expires`) et pose le cookie de session Auth.js. Renseigne
   `users.email_verified` s'il est encore `NULL` (= première connexion réussie).
4. Redirige vers `callback_url`.
5. Token invalide / expiré / révoqué → page d'erreur claire (« lien expiré, demande-en un
   nouveau au trésorier »), pas de 500.

**Risque technique isolé** : forger une session Auth.js « à la main » exige le bon nom de
cookie (`authjs.session-token`, préfixe `__Secure-` en prod), `httpOnly`, `sameSite=lax`,
`path=/`, `expires` cohérent. Encapsulé dans un helper dédié et **testé** (le seul vrai
point dur de la feature).

## UI (`/admin/invitations`)

- Formulaire inchangé (email, rôle, scope si chef).
- Après création : encart **« Lien d'accès direct »** avec le lien + bouton **Copier** +
  mention « valide 7 jours ».
- Mail d'invitation (`sendInvitationEmail`, `web/src/lib/email/invitation.ts`) modifié : le
  bouton/lien pointe vers le lien d'auto-connexion au lieu de `/login`.
- Le lien n'est **affichable qu'une fois** (on ne stocke que le hash). Perdu → régénérer
  (révoque l'ancien, en crée un nouveau). Mention explicite dans l'UI.

## Sécurité & garde-fous

- Lien = identifiant porteur → **hash seul** en base, jamais le token en clair stocké ;
  création tracée (`created_by`).
- **Révocation** possible (`revoked_at`) ; régénération révoque l'ancien lien.
- Rôle `parent` ne peut pas accéder à `/remboursements/nouveau` : si `parent` est choisi,
  le lien atterrit sur l'accueil (mention dans l'UI). Défaut attendu : `equipier`.
- **Aucun `DELETE`** sur les données : on révoque, on régénère (respect règle projet).
- Accès création réservé aux admins (`requireAdmin` : `tresorier` / `RG`, inchangé).

## Tests (TDD)

- **Service `invite-links`** : génération ; résolution OK / expiré / révoqué / introuvable ;
  réutilisation dans la fenêtre de 7 j ; le token en clair n'est jamais persisté.
- **Helper minting de session** : cookie correct (nom/flags/préfixe prod), ligne `sessions`
  valide reconnue par `auth()`, `email_verified` rempli au 1ᵉʳ usage.
- **Idempotence** : email déjà existant dans le groupe → réutilise le user, génère un
  nouveau lien (pas de doublon de user).
- **Route `/i/[token]`** : token valide → redirige connecté vers `callback_url` ; token
  invalide/expiré/révoqué → page d'erreur, pas de session créée.

## Hors scope (YAGNI)

- Pas de gestion fine multi-liens par user dans l'UI (un lien actif à la fois suffit ;
  régénérer remplace).
- Pas de configuration de la durée par le trésorier (7 j en dur).
- Pas de réutilisation des colonnes `edit_token` / `validate_token` (table dédiée à la
  place).
- Pas de lien scopé « formulaire sans compte » (décision : vrai compte + auto-connexion).
